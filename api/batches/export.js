import { currentUser } from "../../server/sso.js";
import { ssoConfigurado } from "../../server/sso-config.js";
import { origemPermitida } from "../../server/origin.js";
import { batchForUser, batchItemsForUser } from "../../server/db.js";
import { csvDeLote } from "../../server/batch-export.js";
import { xlsxDeLote } from "../../server/xlsx.js";
import { auditar, atorUsuario } from "../../server/audit.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "metodo_nao_permitido" });
  if (!origemPermitida(req)) return res.status(403).json({ error: "origem_nao_permitida" });
  if (!ssoConfigurado()) return res.status(503).json({ error: "autenticacao_indisponivel" });
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "autenticacao_necessaria", login: "sso" });
  const id = String((req.query || {}).id || "");

  // A exportação é a maior saída de dado processual do sistema: um arquivo com
  // até 500 números sai da ferramenta e passa a viver fora dela.
  const auditarExportacao = (resultado, formato) => auditar(Object.assign({}, atorUsuario(user), {
    acao: "lote_exportado",
    recurso: "batch:" + id + (formato ? ":" + formato : ""),
    resultado,
    reqId: typeof req.headers["x-vercel-id"] === "string" ? req.headers["x-vercel-id"] : null,
  }));

  const lote = await batchForUser(id, user.id);
  if (!lote) {
    await auditarExportacao("negado_nao_encontrado", null);
    return res.status(404).json({ error: "lote_nao_encontrado" });
  }
  const xlsx = String((req.query || {}).formato || "").toLowerCase() === "xlsx";
  const nome = "triagem-" + id.replace(/[^a-zA-Z0-9-]/g, "") + (xlsx ? ".xlsx" : ".csv");
  const itens = await batchItemsForUser(id, user.id);
  await auditarExportacao("sucesso", xlsx ? "xlsx" : "csv");
  res.setHeader("Content-Type", xlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"" + nome + "\"");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(xlsx ? xlsxDeLote(itens) : csvDeLote(itens));
}
