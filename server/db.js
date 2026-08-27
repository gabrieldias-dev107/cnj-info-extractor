import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { classificarEstagio, ttlPorEstagio } from "./p0-core.js";

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

export async function freshSnapshot(numero) {
  const rows = await sql().query(
    "SELECT s.dados FROM snapshots s JOIN processes p ON p.id=s.process_id WHERE p.numero=$1 AND s.expira_em > now() ORDER BY s.consultado_em DESC LIMIT 1",
    [numero]
  );
  return rows[0] ? rows[0].dados : null;
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

export async function purgeExpired() {
  const db = sql();
  await db.query("DELETE FROM sessions WHERE expires_at <= now()");
  await db.query("DELETE FROM batches WHERE expires_at <= now()");
  await db.query("DELETE FROM snapshots WHERE consultado_em < now() - interval '180 days'");
  await db.query("DELETE FROM users WHERE last_login_at < now() - interval '180 days'");
}
