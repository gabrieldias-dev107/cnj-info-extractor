import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { classificarEstagio, idadeEmDias, ttlPorEstagio } from "./p0-core.js";

function sql() {
  const url = String(process.env.DATABASE_URL || "");
  if (!url) throw new Error("banco_indisponivel");
  return neon(url);
}

export function hashToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

export async function upsertUser({ oid, email }) {
  const id = randomUUID();
  const rows = await sql().query(
    "INSERT INTO users (id, entra_oid, email) VALUES ($1,$2,$3) ON CONFLICT (entra_oid) DO UPDATE SET email=EXCLUDED.email,last_login_at=now() RETURNING id,email",
    [id, oid, email]
  );
  return rows[0];
}

export async function createSession(userId, token, expiresAt) {
  await sql().query("INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4)", [randomUUID(), userId, hashToken(token), expiresAt]);
}

export async function userForSession(token) {
  const rows = await sql().query(
    "SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()",
    [hashToken(token)]
  );
  return rows[0] || null;
}

export async function deleteSession(token) {
  await sql().query("DELETE FROM sessions WHERE token_hash=$1", [hashToken(token)]);
}

// Devolve o snapshot inteiro, não só `dados`: a classificação TPU mora nas
// colunas `estagio*` e ficava de fora da resposta de cache, e o id é o que
// permite ao worker de lote reaproveitar o snapshot em vez de reconsultar.
export async function freshSnapshot(numero) {
  const rows = await sql().query(
    "SELECT s.id,s.process_id,s.dados,s.estagio,s.estagio_codigo,s.estagio_data,s.tpu_versao FROM snapshots s JOIN processes p ON p.id=s.process_id WHERE p.numero=$1 AND s.expira_em > now() ORDER BY s.consultado_em DESC LIMIT 1",
    [numero]
  );
  const linha = rows[0];
  if (!linha) return null;
  const data = linha.estagio_data ? new Date(linha.estagio_data).toISOString() : null;
  return {
    id: linha.id,
    processId: linha.process_id,
    dados: linha.dados,
    estagio: {
      estagio: linha.estagio,
      codigo: linha.estagio_codigo === null || linha.estagio_codigo === undefined ? null : Number(linha.estagio_codigo),
      data,
      idadeDias: data ? idadeEmDias(data) : null,
      versao: linha.tpu_versao,
    },
  };
}

export async function persistSnapshot({ numero, alias, dados }) {
  const consulta = Array.isArray(dados.processos) ? dados.processos : [];
  const movimentos = consulta.flatMap((processo) => processo.movimentos || []);
  const estagio = classificarEstagio(movimentos);
  const agora = new Date();
  const expira = new Date(agora.getTime() + ttlPorEstagio(estagio.estagio));
  const processId = randomUUID();
  const snapshotId = randomUUID();
  const db = sql();
  const processos = await db.query(
    "INSERT INTO processes (id,numero,alias) VALUES ($1,$2,$3) ON CONFLICT (numero) DO UPDATE SET alias=EXCLUDED.alias RETURNING id",
    [processId, numero, alias]
  );
  const id = processos[0].id;
  await db.query(
    "INSERT INTO snapshots (id,process_id,dados,estagio,estagio_codigo,estagio_data,tpu_versao,consultado_em,expira_em) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9)",
    [snapshotId, id, JSON.stringify(dados), estagio.estagio, estagio.codigo, estagio.data, estagio.versao, agora, expira]
  );
  for (const movimento of movimentos) {
    await db.query("INSERT INTO movements (id,snapshot_id,codigo,nome,data_hora) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), snapshotId, movimento.codigo || null, movimento.nome || null, movimento.dataHora || null]);
  }
  return { snapshotId, processId: id, estagio, expira };
}

export async function recordConsultation(userId, processId, origem) {
  await sql().query("INSERT INTO consultation_events (id,user_id,process_id,origem) VALUES ($1,$2,$3,$4)", [randomUUID(), userId, processId, origem]);
}

export async function createBatch(userId, itens) {
  const id = randomUUID();
  const expiraEm = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
  const status = itens.some((item) => item.status === "pendente") ? "pendente" : "concluido";
  const db = sql();
  // tx precisa ser chamado como tx.query(...): na v1 do driver, tx(...) só
  // aceita tagged template e lança em tempo de execução com placeholders.
  await db.transaction((tx) => [
    tx.query("INSERT INTO batches (id,user_id,status,total,expires_at) VALUES ($1,$2,$3,$4,$5)", [id, userId, status, itens.length, expiraEm]),
    ...itens.map((item) => tx.query(
      "INSERT INTO batch_items (id,batch_id,linha,numero,alias,status,erro) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [randomUUID(), id, item.linha, item.numero || null, item.alias || null, item.status, item.erro]
    )),
  ]);
  const linhas = await db.query("SELECT id,linha,numero,alias,status,erro FROM batch_items WHERE batch_id=$1 ORDER BY linha", [id]);
  return { id, expiraEm, itens: linhas };
}

export async function batchForUser(batchId, userId) {
  const batches = await sql().query(
    "SELECT id,status,total,created_at,expires_at FROM batches WHERE id=$1 AND user_id=$2 AND expires_at > now()",
    [batchId, userId]
  );
  if (!batches[0]) return null;
  const itens = await sql().query(
    "SELECT status,COUNT(*)::int AS total FROM batch_items WHERE batch_id=$1 GROUP BY status",
    [batchId]
  );
  return Object.assign({}, batches[0], { contagens: Object.fromEntries(itens.map((item) => [item.status, item.total])) });
}

export async function batchItemsForUser(batchId, userId) {
  return sql().query(
    "SELECT bi.linha,bi.numero,bi.status,bi.erro,s.estagio FROM batch_items bi JOIN batches b ON b.id=bi.batch_id LEFT JOIN snapshots s ON s.id=bi.snapshot_id WHERE bi.batch_id=$1 AND b.user_id=$2 AND b.expires_at > now() ORDER BY bi.linha",
    [batchId, userId]
  );
}

export async function claimBatchItem(itemId) {
  const db = sql();
  const rows = await db.query(
    "UPDATE batch_items SET status='processando',tentativas=tentativas+1 WHERE id=$1 AND status IN ('pendente','falhou') AND tentativas < 3 RETURNING id,batch_id,numero,alias,tentativas,(SELECT user_id FROM batches WHERE id=batch_id) AS user_id",
    [itemId]
  );
  if (!rows[0]) return null;
  await db.query("UPDATE batches SET status='processando' WHERE id=$1", [rows[0].batch_id]);
  return rows[0];
}

export async function finishBatchItem(itemId, { status, erro = null, snapshotId = null }) {
  const rows = await sql().query(
    "UPDATE batch_items SET status=$2,erro=$3,snapshot_id=$4 WHERE id=$1 RETURNING batch_id",
    [itemId, status, erro, snapshotId]
  );
  if (!rows[0]) return;
  await sql().query(
    "UPDATE batches SET status=CASE WHEN EXISTS (SELECT 1 FROM batch_items WHERE batch_id=$1 AND status IN ('pendente','processando')) THEN 'processando' WHEN EXISTS (SELECT 1 FROM batch_items WHERE batch_id=$1 AND status='falhou') THEN 'falhou' ELSE 'concluido' END WHERE id=$1",
    [rows[0].batch_id]
  );
}

// A ordem vai de filha para mãe. O ON DELETE CASCADE da migration cobriria os
// filhos, mas registros P1 vencem antes do pai (um alerta expira sem o
// portfólio expirar), então cada tabela é apagada pelo seu próprio expires_at.
export async function purgeExpired() {
  const db = sql();
  await db.query("DELETE FROM sessions WHERE expires_at <= now()");
  await db.query("DELETE FROM batches WHERE expires_at <= now()");
  await db.query("DELETE FROM alert_send_attempts WHERE expires_at <= now()");
  await db.query("DELETE FROM pending_alerts WHERE expires_at <= now()");
  await db.query("DELETE FROM tribunal_health_measurements WHERE expires_at <= now()");
  await db.query("DELETE FROM health_probes WHERE expires_at <= now()");
  await db.query("DELETE FROM monitored_processes WHERE expires_at <= now()");
  await db.query("DELETE FROM portfolio_members WHERE expires_at <= now()");
  await db.query("DELETE FROM portfolios WHERE expires_at <= now()");
  await db.query("DELETE FROM snapshots WHERE consultado_em < now() - interval '180 days'");
  await db.query("DELETE FROM users WHERE last_login_at < now() - interval '180 days'");
}

function p1ExpiresAt() {
  return new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
}

export async function createPortfolio(userId, { nome }) {
  const rows = await sql().query(
    "INSERT INTO portfolios (id,creator_user_id,nome,expires_at) VALUES ($1,$2,$3,$4) RETURNING id,nome,created_at,updated_at,expires_at,'criador' AS papel",
    [randomUUID(), userId, nome, p1ExpiresAt()]
  );
  return rows[0] || null;
}

export async function portfoliosForUser(userId) {
  return sql().query(
    "SELECT p.id,p.nome,p.created_at,p.updated_at,p.expires_at,CASE WHEN p.creator_user_id=$1 THEN 'criador' ELSE 'membro' END AS papel FROM portfolios p LEFT JOIN portfolio_members pm ON pm.portfolio_id=p.id AND pm.user_id=$1 AND pm.expires_at > now() WHERE p.expires_at > now() AND (p.creator_user_id=$1 OR pm.user_id=$1) ORDER BY p.updated_at DESC",
    [userId]
  );
}

// Este SELECT é a fronteira de leitura compartilhada: quem não é criador nem
// membro ativo recebe o mesmo resultado vazio de um id inexistente.
export async function portfolioForUser(portfolioId, userId) {
  const rows = await sql().query(
    "SELECT p.id,p.nome,CASE WHEN p.creator_user_id=$2 THEN 'criador' ELSE 'membro' END AS papel FROM portfolios p LEFT JOIN portfolio_members pm ON pm.portfolio_id=p.id AND pm.user_id=$2 AND pm.expires_at > now() WHERE p.id=$1 AND p.expires_at > now() AND (p.creator_user_id=$2 OR pm.user_id=$2) LIMIT 1",
    [portfolioId, userId]
  );
  return rows[0] || null;
}

export async function updatePortfolioForCreator(portfolioId, userId, { nome }) {
  const rows = await sql().query(
    "UPDATE portfolios SET nome=$3,updated_at=now() WHERE id=$1 AND creator_user_id=$2 AND expires_at > now() RETURNING id,nome,created_at,updated_at,expires_at,'criador' AS papel",
    [portfolioId, userId, nome]
  );
  return rows[0] || null;
}

export async function deletePortfolioForCreator(portfolioId, userId) {
  const rows = await sql().query(
    "DELETE FROM portfolios WHERE id=$1 AND creator_user_id=$2 AND expires_at > now() RETURNING id",
    [portfolioId, userId]
  );
  return Boolean(rows[0]);
}

export async function portfolioItemsForUser(portfolioId, userId) {
  return sql().query(
    "SELECT mp.id,mp.process_id,mp.intervalo_minutos,mp.proxima_consulta_em,p.numero,p.alias FROM monitored_processes mp JOIN processes p ON p.id=mp.process_id JOIN portfolios po ON po.id=mp.portfolio_id LEFT JOIN portfolio_members pm ON pm.portfolio_id=po.id AND pm.user_id=$2 AND pm.expires_at > now() WHERE mp.portfolio_id=$1 AND mp.expires_at > now() AND po.expires_at > now() AND (po.creator_user_id=$2 OR pm.user_id=$2) ORDER BY mp.created_at DESC",
    [portfolioId, userId]
  );
}

export async function createPortfolioItem(portfolioId, userId, { processId, intervaloMinutos }) {
  const now = new Date();
  const rows = await sql().query(
    "INSERT INTO monitored_processes (id,portfolio_id,process_id,intervalo_minutos,proxima_consulta_em,expires_at) SELECT $1,$2,p.id,$4,$5,$6 FROM portfolios po JOIN processes p ON p.id=$3 WHERE po.id=$2 AND po.creator_user_id=$7 AND po.expires_at > now() RETURNING id,process_id,intervalo_minutos,proxima_consulta_em",
    [randomUUID(), portfolioId, processId, intervaloMinutos, now, p1ExpiresAt(), userId]
  );
  return rows[0] || null;
}

export async function updatePortfolioItemForCreator(portfolioId, itemId, userId, { intervaloMinutos }) {
  const rows = await sql().query(
    "UPDATE monitored_processes mp SET intervalo_minutos=$4,proxima_consulta_em=now() WHERE mp.id=$2 AND mp.portfolio_id=$1 AND mp.expires_at > now() AND EXISTS (SELECT 1 FROM portfolios po WHERE po.id=mp.portfolio_id AND po.creator_user_id=$3 AND po.expires_at > now()) RETURNING id,process_id,intervalo_minutos,proxima_consulta_em",
    [portfolioId, itemId, userId, intervaloMinutos]
  );
  return rows[0] || null;
}

export async function deletePortfolioItemForCreator(portfolioId, itemId, userId) {
  const rows = await sql().query(
    "DELETE FROM monitored_processes mp WHERE mp.id=$2 AND mp.portfolio_id=$1 AND mp.expires_at > now() AND EXISTS (SELECT 1 FROM portfolios po WHERE po.id=mp.portfolio_id AND po.creator_user_id=$3 AND po.expires_at > now()) RETURNING id",
    [portfolioId, itemId, userId]
  );
  return Boolean(rows[0]);
}

export async function portfolioMembersForUser(portfolioId, userId) {
  return sql().query(
    "SELECT u.id,u.email,pm.created_at,pm.expires_at FROM portfolio_members pm JOIN users u ON u.id=pm.user_id JOIN portfolios p ON p.id=pm.portfolio_id LEFT JOIN portfolio_members acesso ON acesso.portfolio_id=p.id AND acesso.user_id=$2 AND acesso.expires_at > now() WHERE pm.portfolio_id=$1 AND pm.expires_at > now() AND p.expires_at > now() AND (p.creator_user_id=$2 OR acesso.user_id=$2) ORDER BY u.email",
    [portfolioId, userId]
  );
}

export async function addPortfolioMemberForCreator(portfolioId, userId, { email }) {
  const rows = await sql().query(
    "INSERT INTO portfolio_members (portfolio_id,user_id,expires_at) SELECT $1,u.id,$4 FROM portfolios p JOIN users u ON lower(u.email)=lower($3) WHERE p.id=$1 AND p.creator_user_id=$2 AND p.expires_at > now() AND u.id <> p.creator_user_id ON CONFLICT (portfolio_id,user_id) DO UPDATE SET expires_at=EXCLUDED.expires_at RETURNING user_id AS id,(SELECT email FROM users WHERE id=user_id) AS email",
    [portfolioId, userId, email, p1ExpiresAt()]
  );
  return rows[0] || null;
}

export async function deletePortfolioMemberForCreator(portfolioId, memberUserId, userId) {
  const rows = await sql().query(
    "DELETE FROM portfolio_members pm USING portfolios p WHERE pm.portfolio_id=$1 AND pm.user_id=$2 AND p.id=pm.portfolio_id AND p.creator_user_id=$3 AND p.expires_at > now() RETURNING pm.user_id AS id",
    [portfolioId, memberUserId, userId]
  );
  return Boolean(rows[0]);
}

// O primeiro SELECT prova o vínculo a um item monitorado. Só então buscamos
// snapshots reduzidos, sem `dados` do DataJud, para não ampliar o contrato.
export async function processHistoryForUser(numero, userId) {
  const db = sql();
  const acessiveis = await db.query(
    "SELECT mp.id FROM monitored_processes mp JOIN processes p ON p.id=mp.process_id JOIN portfolios po ON po.id=mp.portfolio_id LEFT JOIN portfolio_members pm ON pm.portfolio_id=po.id AND pm.user_id=$2 AND pm.expires_at > now() WHERE p.numero=$1 AND mp.expires_at > now() AND po.expires_at > now() AND (po.creator_user_id=$2 OR pm.user_id=$2) ORDER BY mp.created_at DESC LIMIT 1",
    [numero, userId]
  );
  if (!acessiveis[0]) return null;
  const snapshots = await db.query(
    "SELECT s.id,s.consultado_em,s.estagio,s.estagio_codigo,s.estagio_data,s.tpu_versao FROM snapshots s JOIN monitored_processes mp ON mp.process_id=s.process_id WHERE mp.id=$1 AND s.expira_em > now() ORDER BY s.consultado_em DESC",
    [acessiveis[0].id]
  );
  return { snapshots };
}

// ---------------------------------------------------------------------------
// Automação P1: seleção de trabalho devido, medições, alertas e envios.
// Estas funções não têm dono humano na requisição; o escopo vem do próprio
// agendamento, e a validade é sempre reconferida contra o portfólio.
// ---------------------------------------------------------------------------

export async function dueMonitoredProcesses(limite) {
  return sql().query(
    "SELECT mp.id FROM monitored_processes mp JOIN portfolios po ON po.id=mp.portfolio_id WHERE mp.expires_at > now() AND po.expires_at > now() AND mp.proxima_consulta_em <= now() ORDER BY mp.proxima_consulta_em LIMIT $1",
    [limite]
  );
}

export async function monitoredProcessForWorker(monitoredProcessId) {
  const rows = await sql().query(
    "SELECT mp.id,mp.portfolio_id,mp.process_id,mp.intervalo_minutos,mp.estagio_conhecido,mp.estagio_conhecido_codigo,p.numero,p.alias FROM monitored_processes mp JOIN processes p ON p.id=mp.process_id JOIN portfolios po ON po.id=mp.portfolio_id WHERE mp.id=$1 AND mp.expires_at > now() AND po.expires_at > now()",
    [monitoredProcessId]
  );
  return rows[0] || null;
}

// O estágio conhecido é por item monitorado, não por processo: dois portfólios
// que acompanham o mesmo número precisam alertar cada um a sua vez, e uma
// consulta manual no meio do caminho não pode consumir a transição.
export async function updateMonitoredProcessStage(monitoredProcessId, { estagio, codigo = null }) {
  await sql().query(
    "UPDATE monitored_processes SET estagio_conhecido=$2,estagio_conhecido_codigo=$3 WHERE id=$1",
    [monitoredProcessId, estagio, codigo]
  );
}

export async function advanceMonitoredProcess(monitoredProcessId) {
  await sql().query(
    "UPDATE monitored_processes SET proxima_consulta_em=now() + (intervalo_minutos * interval '1 minute') WHERE id=$1",
    [monitoredProcessId]
  );
}

export async function dueHealthProbes(limite) {
  return sql().query(
    "SELECT hp.id FROM health_probes hp JOIN portfolios po ON po.id=hp.portfolio_id WHERE hp.expires_at > now() AND po.expires_at > now() AND hp.proxima_consulta_em <= now() ORDER BY hp.proxima_consulta_em LIMIT $1",
    [limite]
  );
}

export async function healthProbeForWorker(healthProbeId) {
  const rows = await sql().query(
    "SELECT hp.id,hp.numero,hp.alias,hp.intervalo_minutos FROM health_probes hp JOIN portfolios po ON po.id=hp.portfolio_id WHERE hp.id=$1 AND hp.expires_at > now() AND po.expires_at > now()",
    [healthProbeId]
  );
  return rows[0] || null;
}

export async function advanceHealthProbe(healthProbeId) {
  await sql().query(
    "UPDATE health_probes SET proxima_consulta_em=now() + (intervalo_minutos * interval '1 minute') WHERE id=$1",
    [healthProbeId]
  );
}

export async function recordHealthMeasurement({ healthProbeId, status, statusCode = null, duracaoMs = null }) {
  await sql().query(
    "INSERT INTO tribunal_health_measurements (id,health_probe_id,status,status_code,duracao_ms,expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [randomUUID(), healthProbeId, status, statusCode, duracaoMs, p1ExpiresAt()]
  );
}

export async function latestSnapshotForProcess(processId) {
  const rows = await sql().query(
    "SELECT id,estagio,estagio_codigo FROM snapshots WHERE process_id=$1 ORDER BY consultado_em DESC LIMIT 1",
    [processId]
  );
  return rows[0] || null;
}

// Um alerta por destinatário ativo. A deduplicação é do índice único
// (monitored_process_id, recipient_user_id, snapshot_atual_id): reprocessar o
// mesmo snapshot não gera alerta repetido.
export async function createPendingAlerts({ monitoredProcessId, snapshotAnteriorId = null, snapshotAtualId, estagioAnterior = null, estagioAtual }) {
  const db = sql();
  const destinatarios = await db.query(
    "SELECT po.creator_user_id AS user_id FROM monitored_processes mp JOIN portfolios po ON po.id=mp.portfolio_id WHERE mp.id=$1 AND mp.expires_at > now() AND po.expires_at > now() UNION SELECT pm.user_id FROM monitored_processes mp JOIN portfolios po ON po.id=mp.portfolio_id JOIN portfolio_members pm ON pm.portfolio_id=mp.portfolio_id WHERE mp.id=$1 AND mp.expires_at > now() AND po.expires_at > now() AND pm.expires_at > now()",
    [monitoredProcessId]
  );
  const criados = [];
  for (const destinatario of destinatarios) {
    const rows = await db.query(
      "INSERT INTO pending_alerts (id,monitored_process_id,recipient_user_id,snapshot_anterior_id,snapshot_atual_id,estagio_anterior,estagio_atual,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (monitored_process_id,recipient_user_id,snapshot_atual_id) DO NOTHING RETURNING id,recipient_user_id",
      [randomUUID(), monitoredProcessId, destinatario.user_id, snapshotAnteriorId, snapshotAtualId, estagioAnterior, estagioAtual, p1ExpiresAt()]
    );
    if (rows[0]) criados.push(rows[0]);
  }
  return criados;
}

// "Entregue" é a existência de uma tentativa aceita; não há coluna de envio em
// pending_alerts, e o histórico de falhas fica preservado em alert_send_attempts.
// Três filtros compõem a fila do digest:
//   1. ainda não aceito pelo Resend;
//   2. o destinatário continua criador ou membro ativo — quem foi removido do
//      portfólio para de receber número e estágio no e-mail;
//   3. no máximo três tentativas por alerta, para um endereço que rejeita não
//      virar envio diário por 180 dias e queimar o domínio remetente.
export async function undeliveredAlerts() {
  return sql().query(
    "SELECT pa.id,pa.recipient_user_id,u.email,p.numero,pa.estagio_anterior,pa.estagio_atual,pa.created_at FROM pending_alerts pa JOIN users u ON u.id=pa.recipient_user_id JOIN monitored_processes mp ON mp.id=pa.monitored_process_id JOIN processes p ON p.id=mp.process_id JOIN portfolios po ON po.id=mp.portfolio_id LEFT JOIN portfolio_members pm ON pm.portfolio_id=po.id AND pm.user_id=pa.recipient_user_id AND pm.expires_at > now() WHERE pa.expires_at > now() AND mp.expires_at > now() AND po.expires_at > now() AND (po.creator_user_id=pa.recipient_user_id OR pm.user_id=pa.recipient_user_id) AND NOT EXISTS (SELECT 1 FROM alert_send_attempts asa WHERE asa.pending_alert_id=pa.id AND asa.status='enviado') AND (SELECT count(*) FROM alert_send_attempts asa WHERE asa.pending_alert_id=pa.id) < 3 ORDER BY u.email,pa.created_at"
  );
}

export async function recordAlertSendAttempt(pendingAlertId, { status, erro = null }) {
  await sql().query(
    "INSERT INTO alert_send_attempts (id,pending_alert_id,status,erro,expires_at) VALUES ($1,$2,$3,$4,$5)",
    [randomUUID(), pendingAlertId, status, erro, p1ExpiresAt()]
  );
}

export async function healthProbesForUser(portfolioId, userId) {
  return sql().query(
    "SELECT hp.id,hp.numero,hp.alias,hp.intervalo_minutos,hp.proxima_consulta_em FROM health_probes hp JOIN portfolios p ON p.id=hp.portfolio_id LEFT JOIN portfolio_members pm ON pm.portfolio_id=p.id AND pm.user_id=$2 AND pm.expires_at > now() WHERE hp.portfolio_id=$1 AND hp.expires_at > now() AND p.expires_at > now() AND (p.creator_user_id=$2 OR pm.user_id=$2) ORDER BY hp.created_at DESC",
    [portfolioId, userId]
  );
}

// `numero` e `alias` chegam já validados pelo handler, que deriva o alias do
// número com `validarNumeroParaConsulta`; aqui os dois são apenas gravados.
export async function createHealthProbe(portfolioId, userId, { numero, alias, intervaloMinutos }) {
  const now = new Date();
  const rows = await sql().query(
    "INSERT INTO health_probes (id,portfolio_id,numero,alias,intervalo_minutos,proxima_consulta_em,expires_at) SELECT $1,$2,$4,$5,$6,$7,$8 FROM portfolios WHERE id=$2 AND creator_user_id=$3 AND expires_at > now() RETURNING id,numero,alias,intervalo_minutos,proxima_consulta_em",
    [randomUUID(), portfolioId, userId, numero, alias, intervaloMinutos, now, p1ExpiresAt()]
  );
  return rows[0] || null;
}

// Número e alias andam juntos: ou os dois são trocados, ou os dois ficam.
export async function updateHealthProbeForCreator(portfolioId, probeId, userId, { numero = null, alias = null, intervaloMinutos }) {
  const rows = await sql().query(
    "UPDATE health_probes hp SET numero=COALESCE($4,hp.numero),alias=COALESCE($5,hp.alias),intervalo_minutos=$6,proxima_consulta_em=now() WHERE hp.id=$2 AND hp.portfolio_id=$1 AND hp.expires_at > now() AND EXISTS (SELECT 1 FROM portfolios p WHERE p.id=hp.portfolio_id AND p.creator_user_id=$3 AND p.expires_at > now()) RETURNING id,numero,alias,intervalo_minutos,proxima_consulta_em",
    [portfolioId, probeId, userId, numero, alias, intervaloMinutos]
  );
  return rows[0] || null;
}

export async function deleteHealthProbeForCreator(portfolioId, probeId, userId) {
  const rows = await sql().query(
    "DELETE FROM health_probes hp WHERE hp.id=$2 AND hp.portfolio_id=$1 AND hp.expires_at > now() AND EXISTS (SELECT 1 FROM portfolios p WHERE p.id=hp.portfolio_id AND p.creator_user_id=$3 AND p.expires_at > now()) RETURNING id",
    [portfolioId, probeId, userId]
  );
  return Boolean(rows[0]);
}
