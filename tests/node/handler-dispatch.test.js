import assert from "node:assert/strict";
import test from "node:test";
import { despachar } from "../../server/handlers/dispatch.js";

function resposta() {
  return {
    statusCode: null,
    body: undefined,
    status(codigo) { this.statusCode = codigo; return this; },
    json(valor) { this.body = valor; return this; },
    end() { return this; },
  };
}

test("dispatcher de worker restaura a URL pública assinada pelo QStash", async () => {
  let urlVista;
  const handler = despachar(
    { tick: async (req) => { urlVista = req.url; } },
    { urlsPublicas: { tick: "/api/monitor-worker" } },
  );
  const req = { query: { handler: "tick" }, url: "/api/p1-monitor-handler?handler=tick" };

  await handler(req, {});

  assert.equal(urlVista, "/api/monitor-worker");
  assert.equal(req.url, "/api/p1-monitor-handler?handler=tick");
});

// A Vercel mescla a query do rewrite com a do cliente: quem chama
// /api/v1/processos?handler=session faz `handler` chegar como array. Escolher um
// dos valores deixaria um chamador com token de serviço dirigir a Function para
// uma rota de cookie. Ambiguidade é recusada, não resolvida.
test("handler duplicado na query vira 400 rota_ambigua sem executar rota alguma", async () => {
  let executou = 0;
  const handler = despachar({ session: async () => { executou += 1; } });
  const res = resposta();

  await handler({ query: { handler: ["decodificar", "session"] } }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "rota_ambigua" });
  assert.equal(executou, 0);
});

test("handler ausente ou herdado do protótipo vira 404, nunca execução", async () => {
  const handler = despachar({ session: async () => {} });

  for (const query of [{}, { handler: "toString" }, { handler: "constructor" }, { handler: "inexistente" }]) {
    const res = resposta();
    await handler({ query }, res);
    assert.equal(res.statusCode, 404, JSON.stringify(query));
    assert.deepEqual(res.body, { error: "rota_nao_encontrada" });
  }
});
