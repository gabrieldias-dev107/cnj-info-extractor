import { currentUser } from "../../server/sso.js";
import { ssoConfigurado } from "../../server/sso-config.js";
import { origemPermitida } from "../../server/origin.js";
import { numerosDaPlanilha, prepararLote } from "../../server/batch-service.js";
import { createBatch, finishBatchItem } from "../../server/db.js";
import { publishBatchItem } from "../../server/queue.js";
import { lerPlanilhaXlsx } from "../../server/xlsx.js";
import { lerPlanilhaCsv } from "../../server/csv.js";

const LIMITE = 2 * 1024 * 1024;
export const config = { api: { bodyParser: false } };

async function lerBody(req) {
  const partes = [];
  let tamanho = 0;
  for await (const parte of req) {
    tamanho += parte.length;
    if (tamanho > LIMITE) throw new Error("arquivo_maior_que_2mb");
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

function erro(res, status, codigo) { return res.status(status).json({ error: codigo }); }

// O formato vem do Content-Type, nunca do nome do arquivo enviado pelo cliente.
function lerPlanilha(req, bruto) {
  const tipo = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (tipo === "text/csv") return lerPlanilhaCsv(bruto);
  if (tipo === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return lerPlanilhaXlsx(bruto);
  throw new Error("formato_nao_suportado");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return erro(res, 405, "metodo_nao_permitido");
  if (!origemPermitida(req)) return erro(res, 403, "origem_nao_permitida");
  if (!ssoConfigurado()) return erro(res, 503, "autenticacao_indisponivel");
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "autenticacao_necessaria", login: "sso" });
  try {
    const itens = prepararLote(numerosDaPlanilha(lerPlanilha(req, await lerBody(req))));
    const lote = await createBatch(user.id, itens);
    await Promise.all(lote.itens.filter((item) => item.status === "pendente").map(async (item) => {
      try { await publishBatchItem(item.id); }
      catch { await finishBatchItem(item.id, { status: "falhou", erro: "fila_indisponivel" }); }
    }));
    return res.status(202).json({ id: lote.id, total: itens.length, expiraEm: lote.expiraEm });
  } catch (error) {
    const codigo = String((error && error.message) || "lote_indisponivel");
    if (["lote_invalido", "lote_vazio", "lote_maior_que_500", "xlsx_invalido", "csv_invalido", "formato_nao_suportado", "arquivo_maior_que_2mb"].includes(codigo)) return erro(res, 400, codigo);
    return erro(res, 503, "lote_indisponivel");
  }
}
