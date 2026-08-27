import { purgeExpired } from "../../server/db.js";
import { verifyQstash } from "../../server/queue.js";
export const config = { api: { bodyParser: false } };
async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); }
export default async function handler(req, res) { try { const raw = await body(req); if (!await verifyQstash(req, raw)) return res.status(401).json({ error: "assinatura_invalida" }); await purgeExpired(); return res.status(204).end(); } catch (error) { return res.status(503).json({ error: error.message || "manutencao_indisponivel" }); } }
