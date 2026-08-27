import assert from "node:assert/strict";
import test, { mock } from "node:test";

function resposta() {
  return {
    statusCode: null,
    body: undefined,
    status(codigo) { this.statusCode = codigo; return this; },
    json(valor) { this.body = valor; return this; },
    end() { return this; },
  };
}

function requisicao(corpo = "") {
  const stream = (async function* () { if (corpo) yield Buffer.from(corpo); })();
  stream.headers = { "upstash-signature": "assinatura" };
  stream.url = "/api/maintenance/purge";
  return stream;
}

// Um único mock por módulo: node:test recusa remockar o mesmo especificador.
// Cada teste troca as implementações destas variáveis.
let verificarAssinatura = async () => true;
let expurgar = async () => {};

mock.module("../../server/db.js", { namedExports: { purgeExpired: (...args) => expurgar(...args) } });
mock.module("../../server/queue.js", { namedExports: { verifyQstash: (...args) => verificarAssinatura(...args) } });

const { default: handler } = await import("../../api/maintenance/purge.js");

async function carregar({ verifica, purga }) {
  verificarAssinatura = verifica;
  expurgar = purga;
  return handler;
}

test("expurgo rejeita requisição sem assinatura QStash válida", async () => {
  let purgou = 0;
  const handler = await carregar({ verifica: async () => false, purga: async () => { purgou += 1; } });
  const res = resposta();
  await handler(requisicao(""), res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "assinatura_invalida" });
  assert.equal(purgou, 0, "não pode expurgar sem assinatura válida");
});

test("expurgo assinado apaga registros vencidos e responde 204", async () => {
  let purgou = 0;
  const handler = await carregar({ verifica: async () => true, purga: async () => { purgou += 1; } });
  const res = resposta();
  await handler(requisicao(""), res);
  assert.equal(res.statusCode, 204);
  assert.equal(purgou, 1);
});

test("falha do banco vira 503 em vez de derrubar o job", async () => {
  const handler = await carregar({
    verifica: async () => true,
    purga: async () => { throw new Error("banco_indisponivel"); },
  });
  const res = resposta();
  await handler(requisicao(""), res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "banco_indisponivel" });
});

test("assinatura é verificada sobre o corpo bruto recebido", async () => {
  const vistos = [];
  const handler = await carregar({
    verifica: async (_req, corpo) => { vistos.push(corpo); return true; },
    purga: async () => {},
  });
  await handler(requisicao('{"origem":"cron"}'), resposta());
  assert.deepEqual(vistos, ['{"origem":"cron"}']);
});
