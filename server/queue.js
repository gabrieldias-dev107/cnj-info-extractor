import { Client, Receiver } from "@upstash/qstash";

function required(name) { const value = String(process.env[name] || ""); if (!value) throw new Error("fila_indisponivel"); return value; }
export async function publishBatchItem(itemId) {
  const client = new Client({ token: required("QSTASH_TOKEN") });
  return client.publishJSON({ url: required("APP_BASE_URL") + "/api/batch-worker", body: { itemId }, retries: 3, flowControl: { key: "cnj-datajud-batch", parallelism: 5 } });
}
export async function verifyQstash(req, body) {
  const receiver = new Receiver({ currentSigningKey: required("QSTASH_CURRENT_SIGNING_KEY"), nextSigningKey: required("QSTASH_NEXT_SIGNING_KEY") });
  return receiver.verify({ signature: String(req.headers["upstash-signature"] || ""), body, url: required("APP_BASE_URL") + req.url });
}
