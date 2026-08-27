import { claimBatchItem, finishBatchItem, freshSnapshot, persistSnapshot, recordConsultation } from "../server/db.js";
import { consultarDatajud } from "../server/datajud-client.js";
import { verifyQstash } from "../server/queue.js";
import { consumirDatajud } from "../server/rate-limit.js";

export const config = { api: { bodyParser: false } };

async function lerBody(req) {
  const partes = [];
  for await (const parte of req) partes.push(parte);
  return Buffer.concat(partes).toString("utf8");
}

function codigo(error) {
  return String((error && (error.codigo || error.message)) || "erro_interno");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "metodo_nao_permitido" });
  let item;
  try {
    const raw = await lerBody(req);
    if (!await verifyQstash(req, raw)) return res.status(401).json({ error: "assinatura_invalida" });
    const body = JSON.parse(raw);
    if (!body || typeof body.itemId !== "string") return res.status(400).json({ error: "item_invalido" });
    item = await claimBatchItem(body.itemId);
    if (!item) return res.status(204).end();

    // Reaproveita o snapshot ainda válido, como a consulta única já faz. Sem
    // isto, relançar o mesmo lote refazia a chamada ao DataJud e reinseria
    // todos os movimentos do processo a cada vez.
    const emCache = await freshSnapshot(item.numero);
    if (emCache) {
      await recordConsultation(item.user_id, emCache.processId, "lote");
      await finishBatchItem(item.id, { status: "concluido", snapshotId: emCache.id });
      return res.status(204).end();
    }

    const limite = await consumirDatajud({ headers: { "x-forwarded-for": "qstash-batch" } });
    if (!limite.permitido) throw new Error("limite_excedido");
    const resposta = await consultarDatajud(item.numero, item.alias);
    const salvo = await persistSnapshot({ numero: item.numero, alias: item.alias, dados: resposta });
    await recordConsultation(item.user_id, salvo.processId, "lote");
    await finishBatchItem(item.id, { status: "concluido", snapshotId: salvo.snapshotId });
    return res.status(204).end();
  } catch (error) {
    const erro = codigo(error);
    if (item) await finishBatchItem(item.id, { status: "falhou", erro });
    if (["alias_inexistente", "config_ausente"].includes(erro)) return res.status(204).end();
    return res.status(500).json({ error: erro });
  }
}
