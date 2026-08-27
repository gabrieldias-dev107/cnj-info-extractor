import { currentUser } from "../../server/sso.js";
import { ssoConfigurado } from "../../server/sso-config.js";
import { origemPermitida } from "../../server/origin.js";
import { prepararLote } from "../../server/batch-service.js";
import { batchForUser, batchItemsForUser, createBatch, finishBatchItem } from "../../server/db.js";
import { publishBatchItem } from "../../server/queue.js";

export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };

function erro(res, status, codigo) {
  return res.status(status).json({ error: codigo });
}

function body(req) {
  if (typeof req.body !== "string") return req.body || {};
  try { return JSON.parse(req.body); } catch { return {}; }
}

export default async function handler(req, res) {
  if (!origemPermitida(req)) return erro(res, 403, "origem_nao_permitida");
  if (!ssoConfigurado()) return erro(res, 503, "autenticacao_indisponivel");
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "autenticacao_necessaria", login: "sso" });

  if (req.method === "GET") {
    const id = String((req.query || {}).id || "");
    if (!id) return erro(res, 400, "lote_invalido");
    const lote = await batchForUser(id, user.id);
    if (!lote) return erro(res, 404, "lote_nao_encontrado");
    // A triagem por linha (com o estágio TPU) é o resultado que interessa;
    // sem ela o painel só mostrava um contador agregado.
    const itens = await batchItemsForUser(id, user.id);
    return res.status(200).json(Object.assign({}, lote, { itens }));
  }
  if (req.method !== "POST") return erro(res, 405, "metodo_nao_permitido");

  try {
    const itens = prepararLote(body(req).numeros);
    const lote = await createBatch(user.id, itens);
    const pendentes = lote.itens.filter((item) => item.status === "pendente");
    await Promise.all(pendentes.map(async (item) => {
      try { await publishBatchItem(item.id); }
      catch { await finishBatchItem(item.id, { status: "falhou", erro: "fila_indisponivel" }); }
    }));
    return res.status(202).json({ id: lote.id, total: itens.length, expiraEm: lote.expiraEm });
  } catch (error) {
    const codigo = error && error.message;
    if (["lote_invalido", "lote_vazio", "lote_maior_que_500"].includes(codigo)) return erro(res, 400, codigo);
    return erro(res, 503, "lote_indisponivel");
  }
}
