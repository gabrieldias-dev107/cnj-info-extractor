import { Client, Receiver } from "@upstash/qstash";

function required(name) { const value = String(process.env[name] || ""); if (!value) throw new Error("fila_indisponivel"); return value; }

// Em deployments com Deployment Protection ligada, a Vercel responde 302 para
// o SSO dela antes de a requisição chegar ao handler — o job do QStash morreria
// no redirecionamento. O bypass vai por header, e não por query string, para
// não alterar `req.url`: verifyQstash assina APP_BASE_URL + req.url, e um
// parâmetro a mais invalidaria a assinatura. `VERCEL_AUTOMATION_BYPASS_SECRET`
// é injetada pela própria Vercel quando o bypass está configurado; sem ela
// nenhum header é enviado.
function cabecalhosDestino() {
  const segredo = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "").trim();
  return segredo ? { "x-vercel-protection-bypass": segredo } : undefined;
}

export async function publishBatchItem(itemId) {
  const client = new Client({ token: required("QSTASH_TOKEN") });
  return client.publishJSON({
    url: required("APP_BASE_URL") + "/api/batch-worker",
    body: { itemId },
    headers: cabecalhosDestino(),
    retries: 3,
    flowControl: { key: "cnj-datajud-batch", parallelism: 5 },
  });
}
export async function verifyQstash(req, body) {
  // required() fica fora do try: chave de assinatura ausente é erro de
  // configuração e precisa continuar explodindo, não virar "assinatura inválida".
  const receiver = new Receiver({ currentSigningKey: required("QSTASH_CURRENT_SIGNING_KEY"), nextSigningKey: required("QSTASH_NEXT_SIGNING_KEY") });
  const url = required("APP_BASE_URL") + req.url;
  // O SDK lança (SignatureError) quando a assinatura falta ou é malformada, e
  // só devolve false quando ela é bem-formada e não confere. Sem este catch a
  // exceção subia até o handler e virava 500 — que o QStash retenta.
  try {
    return await receiver.verify({ signature: String(req.headers["upstash-signature"] || ""), body, url });
  } catch {
    return false;
  }
}
