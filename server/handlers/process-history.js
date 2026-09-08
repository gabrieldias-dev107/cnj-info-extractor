import { currentUser } from "../sso.js";
import { ssoConfigurado } from "../sso-config.js";
import { origemPermitida } from "../origin.js";
import { processHistoryForUser } from "../db.js";
import { mudancaRelevante } from "../p1-core.js";
import { auditar, atorUsuario } from "../audit.js";

function erro(res, status, codigo) {
  return res.status(status).json({ error: codigo });
}

function reqId(req) {
  const valor = req.headers && req.headers["x-vercel-id"];
  return typeof valor === "string" ? valor : null;
}

function snapshotPublico(snapshot) {
  return {
    id: snapshot.id,
    consultadoEm: snapshot.consultado_em,
    estagio: snapshot.estagio,
    codigo: snapshot.estagio_codigo === null || snapshot.estagio_codigo === undefined ? null : Number(snapshot.estagio_codigo),
    data: snapshot.estagio_data || null,
    versao: snapshot.tpu_versao || null,
  };
}

export default async function handler(req, res) {
  if (!origemPermitida(req)) return erro(res, 403, "origem_nao_permitida");
  if (!ssoConfigurado()) return erro(res, 503, "autenticacao_indisponivel");
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "autenticacao_necessaria", login: "sso" });
  if (req.method !== "GET") return erro(res, 405, "metodo_nao_permitido");

  const numero = String((req.query || {}).numero || "").replace(/\D/g, "");
  if (!/^\d{20}$/.test(numero)) return erro(res, 400, "numero_invalido");

  // O histórico é leitura de dado processual de terceiro; o 404 aqui pode ser
  // tanto processo inexistente quanto tentativa de ler carteira alheia. Os dois
  // casos entram na trilha, sem o número — a vinculação é por `process_id`, e
  // esta rota parte do número, então o recurso registrado é só a ação.
  const auditarLeitura = (resultado) => auditar(Object.assign({}, atorUsuario(user), {
    acao: "historico_processo", recurso: null, resultado, reqId: reqId(req),
  }));

  try {
    const historico = await processHistoryForUser(numero, user.id);
    if (!historico) {
      await auditarLeitura("negado_nao_encontrado");
      return erro(res, 404, "processo_nao_encontrado");
    }
    await auditarLeitura("sucesso");
    const snapshots = (Array.isArray(historico) ? historico : historico.snapshots || []).map(snapshotPublico);
    const atual = snapshots[0] || null;
    const anterior = snapshots[1] || null;
    const delta = atual && anterior ? {
      anterior: anterior.estagio,
      atual: atual.estagio,
      relevante: mudancaRelevante(anterior, atual),
    } : null;
    return res.status(200).json({ snapshots, delta });
  } catch {
    return erro(res, 503, "historico_indisponivel");
  }
}
