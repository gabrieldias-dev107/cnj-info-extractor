import { advanceMonitoredProcess, dueMonitoredProcesses } from "../server/db.js";
import { publishMonitoredProcess, verifyQstash } from "../server/queue.js";

export const config = { api: { bodyParser: false } };

// Um tick por agendamento externo do QStash. Ele só escolhe o trabalho devido
// e publica um job por item; a chamada ao DataJud acontece no item-worker,
// dentro do mesmo flow control de cinco trabalhadores do lote manual.
const MAXIMO_POR_TICK = 100;

async function lerBody(req) {
  const partes = [];
  for await (const parte of req) partes.push(parte);
  return Buffer.concat(partes).toString("utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "metodo_nao_permitido" });
  try {
    const raw = await lerBody(req);
    if (!await verifyQstash(req, raw)) return res.status(401).json({ error: "assinatura_invalida" });

    const devidos = await dueMonitoredProcesses(MAXIMO_POR_TICK);
    let publicados = 0;
    let falhas = 0;
    for (const item of devidos) {
      try {
        // Publicar antes de adiar: se a publicação falhar, o item continua
        // devido e o próximo tick tenta de novo, sem consulta perdida.
        await publishMonitoredProcess(item.id);
        await advanceMonitoredProcess(item.id);
        publicados += 1;
      } catch {
        falhas += 1;
      }
    }
    return res.status(falhas ? 500 : 200).json({ publicados, falhas });
  } catch (error) {
    return res.status(503).json({ error: String((error && (error.codigo || error.message)) || "monitoramento_indisponivel") });
  }
}
