import assert from "node:assert/strict";
import test, { mock } from "node:test";

const publicados = [];
const verificacoes = [];
let resultadoVerificacao = true;

class ClientFake {
  constructor(config) { this.config = config; }
  async publishJSON(pedido) { publicados.push({ token: this.config.token, pedido }); return { messageId: "msg-1" }; }
}
class ReceiverFake {
  constructor(config) { this.config = config; }
  async verify(pedido) { verificacoes.push({ config: this.config, pedido }); return resultadoVerificacao; }
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

test("assinatura ausente é verificada como string vazia, nunca ignorada", async () => {
  verificacoes.length = 0;
  resultadoVerificacao = false;
  const req = { headers: {}, url: "/api/maintenance/purge" };
  const ok = await comAmbiente(AMBIENTE, () => verifyQstash(req, ""));

  assert.equal(ok, false);
  assert.equal(verificacoes[0].pedido.signature, "");
});

test("sem chaves de assinatura a verificação falha em vez de liberar", async () => {
  await assert.rejects(
    () => comAmbiente({ ...AMBIENTE, QSTASH_CURRENT_SIGNING_KEY: "" }, () =>
      verifyQstash({ headers: {}, url: "/api/batch-worker" }, "")),
    /fila_indisponivel/
  );
});
