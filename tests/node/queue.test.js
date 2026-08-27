import assert from "node:assert/strict";
import test, { mock } from "node:test";

const publicados = [];
const verificacoes = [];
let resultadoVerificacao = true;

class ClientFake {
  constructor(config) { this.config = config; }
  async publishJSON(pedido) { publicados.push({ token: this.config.token, pedido }); return { messageId: "msg-1" }; }
}
// O SDK real LANÇA quando a assinatura falta ou é malformada, e só devolve
// false quando ela é bem-formada e não confere. O fake antigo sempre retornava,
// e foi por isso que o BUG-1 (500 em vez de 401) passou verde.
class ReceiverFake {
  constructor(config) { this.config = config; }
  async verify(pedido) {
    verificacoes.push({ config: this.config, pedido });
    if (!pedido.signature) { const e = new Error("Invalid Compact JWS"); e.name = "SignatureError"; throw e; }
    return resultadoVerificacao;
  }
}

mock.module("@upstash/qstash", { namedExports: { Client: ClientFake, Receiver: ReceiverFake } });

const { publishBatchItem, verifyQstash } = await import("../../server/queue.js");

function comAmbiente(valores, executar) {
  const anterior = { ...process.env };
  Object.assign(process.env, valores);
  return (async () => { try { return await executar(); } finally { process.env = anterior; } })();
}

const AMBIENTE = {
  QSTASH_TOKEN: "token-qstash",
  APP_BASE_URL: "https://app.vercel.app",
  QSTASH_CURRENT_SIGNING_KEY: "chave-atual",
  QSTASH_NEXT_SIGNING_KEY: "chave-proxima",
};

test("publishBatchItem aponta para o worker com controle de paralelismo", async () => {
  publicados.length = 0;
  await comAmbiente(AMBIENTE, () => publishBatchItem("item-1"));

  assert.equal(publicados.length, 1);
  assert.equal(publicados[0].token, "token-qstash");
  assert.equal(publicados[0].pedido.url, "https://app.vercel.app/api/batch-worker");
  assert.deepEqual(publicados[0].pedido.body, { itemId: "item-1" });
  assert.equal(publicados[0].pedido.retries, 3);
  // O teto de paralelismo é o que protege a cota do DataJud.
  assert.deepEqual(publicados[0].pedido.flowControl, { key: "cnj-datajud-batch", parallelism: 5 });
});

test("bypass da proteção da Vercel vai por header, não na URL", async () => {
  publicados.length = 0;
  await comAmbiente({ ...AMBIENTE, VERCEL_AUTOMATION_BYPASS_SECRET: "segredo-bypass" }, () => publishBatchItem("item-1"));

  assert.deepEqual(publicados[0].pedido.headers, { "x-vercel-protection-bypass": "segredo-bypass" });
  // Query string mudaria req.url e quebraria a assinatura conferida em verifyQstash.
  assert.equal(publicados[0].pedido.url, "https://app.vercel.app/api/batch-worker");
});

test("sem o segredo de bypass nenhum header extra é enviado", async () => {
  publicados.length = 0;
  await comAmbiente({ ...AMBIENTE, VERCEL_AUTOMATION_BYPASS_SECRET: "" }, () => publishBatchItem("item-1"));
  assert.equal(publicados[0].pedido.headers, undefined);
});

test("sem QSTASH_TOKEN a publicação falha como fila_indisponivel", async () => {
  await assert.rejects(
    () => comAmbiente({ ...AMBIENTE, QSTASH_TOKEN: "" }, () => publishBatchItem("item-1")),
    /fila_indisponivel/
  );
});

test("verifyQstash confere assinatura contra corpo bruto e URL absoluta", async () => {
  verificacoes.length = 0;
  resultadoVerificacao = true;
  const req = { headers: { "upstash-signature": "assinatura" }, url: "/api/batch-worker" };
  const ok = await comAmbiente(AMBIENTE, () => verifyQstash(req, '{"itemId":"item-1"}'));

  assert.equal(ok, true);
  assert.deepEqual(verificacoes[0].config, { currentSigningKey: "chave-atual", nextSigningKey: "chave-proxima" });
  assert.equal(verificacoes[0].pedido.signature, "assinatura");
  assert.equal(verificacoes[0].pedido.body, '{"itemId":"item-1"}');
  assert.equal(verificacoes[0].pedido.url, "https://app.vercel.app/api/batch-worker");
});

// Regressão do BUG-1: a exceção do SDK subia até o handler e virava 500, que o
// QStash trata como retentável — requisição não assinada gerava 4 entregas.
test("assinatura ausente vira false, não exceção", async () => {
  verificacoes.length = 0;
  resultadoVerificacao = true;
  const req = { headers: {}, url: "/api/maintenance/purge" };
  const ok = await comAmbiente(AMBIENTE, () => verifyQstash(req, ""));

  assert.equal(ok, false);
  assert.equal(verificacoes[0].pedido.signature, "", "a assinatura vazia ainda é submetida, nunca ignorada");
});

test("assinatura bem-formada que não confere também vira false", async () => {
  verificacoes.length = 0;
  resultadoVerificacao = false;
  const req = { headers: { "upstash-signature": "assinatura-errada" }, url: "/api/batch-worker" };
  assert.equal(await comAmbiente(AMBIENTE, () => verifyQstash(req, "")), false);
});

test("sem chaves de assinatura a verificação falha em vez de liberar", async () => {
  await assert.rejects(
    () => comAmbiente({ ...AMBIENTE, QSTASH_CURRENT_SIGNING_KEY: "" }, () =>
      verifyQstash({ headers: {}, url: "/api/batch-worker" }, "")),
    /fila_indisponivel/
  );
});
