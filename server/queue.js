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

// Uma única chave de flow control para todo o tráfego que sai daqui rumo ao
// DataJud: lote manual e automação P1 dividem os mesmos cinco trabalhadores,
// em vez de a automação abrir uma segunda faixa de concorrência.
const FLUXO_DATAJUD = { key: "cnj-datajud-batch", parallelism: 5 };

function publicar(caminho, body) {
  const client = new Client({ token: required("QSTASH_TOKEN") });
  return client.publishJSON({
    url: required("APP_BASE_URL") + caminho,
    body,
    headers: cabecalhosDestino(),
    retries: 3,
    flowControl: FLUXO_DATAJUD,
  });
}

export async function publishBatchItem(itemId) {
  return publicar("/api/batch-worker", { itemId });
}

// Só identificadores viajam pela fila; o número CNJ é lido do banco dentro do
// worker e nunca entra no corpo publicado.
export async function publishMonitoredProcess(monitoredProcessId) {
  return publicar("/api/monitor-item-worker", { monitoredProcessId });
}

export async function publishHealthProbe(healthProbeId) {
  return publicar("/api/health-item-worker", { healthProbeId });
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
