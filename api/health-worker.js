import { advanceHealthProbe, dueHealthProbes } from "../server/db.js";
import { publishHealthProbe, verifyQstash } from "../server/queue.js";

export const config = { api: { bodyParser: false } };

// A saúde tem orçamento menor (120/dia contra 480 do monitoramento), então o
// tick de saúde também publica menos por rodada.
const MAXIMO_POR_TICK = 50;

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

    const devidos = await dueHealthProbes(MAXIMO_POR_TICK);
    let publicados = 0;
    let falhas = 0;
    for (const probe of devidos) {
      try {
        await publishHealthProbe(probe.id);
        await advanceHealthProbe(probe.id);
        publicados += 1;
      } catch {
        falhas += 1;
      }
    }
    return res.status(falhas ? 500 : 200).json({ publicados, falhas });
  } catch (error) {
    return res.status(503).json({ error: String((error && (error.codigo || error.message)) || "saude_indisponivel") });
  }
}
