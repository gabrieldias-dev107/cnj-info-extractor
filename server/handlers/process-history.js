import { currentUser } from "../sso.js";
import { ssoConfigurado } from "../sso-config.js";
import { origemPermitida } from "../origin.js";
import { processHistoryForUser } from "../db.js";
import { mudancaRelevante } from "../p1-core.js";

function erro(res, status, codigo) {
  return res.status(status).json({ error: codigo });
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

  try {
    const historico = await processHistoryForUser(numero, user.id);
    if (!historico) return erro(res, 404, "processo_nao_encontrado");
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
