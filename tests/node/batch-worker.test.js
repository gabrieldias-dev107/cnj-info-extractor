import assert from "node:assert/strict";
import test, { mock } from "node:test";

// Um mock por módulo (node:test recusa remockar), com implementações trocáveis.
const estado = {
  verificarAssinatura: async () => true,
  reivindicar: async () => ({ id: "item-1", numero: "00013278820188260344", alias: "api_publica_tjsp", user_id: "user-1" }),
  consultar: async () => ({ encontrado: true, total: 1, processos: [{ numero: "00013278820188260344" }] }),
  persistir: async () => ({ snapshotId: "snap-1", processId: "proc-1" }),
  limite: async () => ({ permitido: true }),
};
const finalizados = [];
const consultasRegistradas = [];

mock.module("../../server/db.js", {
  namedExports: {
    claimBatchItem: (...args) => estado.reivindicar(...args),
    finishBatchItem: async (id, dados) => { finalizados.push({ id, ...dados }); },
    persistSnapshot: (...args) => estado.persistir(...args),
    recordConsultation: async (...args) => { consultasRegistradas.push(args); },
  },
});
mock.module("../../server/datajud-client.js", { namedExports: { consultarDatajud: (...args) => estado.consultar(...args) } });
mock.module("../../server/queue.js", { namedExports: { verifyQstash: (...args) => estado.verificarAssinatura(...args) } });
mock.module("../../server/rate-limit.js", { namedExports: { consumirDatajud: (...args) => estado.limite(...args) } });

const { default: handler } = await import("../../api/batch-worker.js");

function resposta() {
  return {
    statusCode: null,
    body: undefined,
    status(codigo) { this.statusCode = codigo; return this; },
    json(valor) { this.body = valor; return this; },
    end() { return this; },
  };
}

function requisicao(corpo, method = "POST") {
  const stream = (async function* () { yield Buffer.from(corpo); })();
  stream.method = method;
  stream.headers = { "upstash-signature": "assinatura" };
  stream.url = "/api/batch-worker";
  return stream;
}

function reiniciar() {
  finalizados.length = 0;
  consultasRegistradas.length = 0;
  estado.verificarAssinatura = async () => true;
  estado.reivindicar = async () => ({ id: "item-1", numero: "00013278820188260344", alias: "api_publica_tjsp", user_id: "user-1" });
  estado.consultar = async () => ({ encontrado: true, total: 1, processos: [{ numero: "00013278820188260344" }] });
  estado.persistir = async () => ({ snapshotId: "snap-1", processId: "proc-1" });
  estado.limite = async () => ({ permitido: true });
}

test("assinatura QStash inválida impede qualquer consulta", async () => {
  reiniciar();
  let reivindicou = 0;
  estado.verificarAssinatura = async () => false;
  estado.reivindicar = async () => { reivindicou += 1; return null; };
  const res = resposta();
  await handler(requisicao('{"itemId":"item-1"}'), res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "assinatura_invalida" });
  assert.equal(reivindicou, 0);
});

test("caminho feliz grava snapshot, audita e conclui o item", async () => {
  reiniciar();
  const res = resposta();
  await handler(requisicao('{"itemId":"item-1"}'), res);
  assert.equal(res.statusCode, 204);
  assert.deepEqual(finalizados, [{ id: "item-1", status: "concluido", snapshotId: "snap-1" }]);
  assert.deepEqual(consultasRegistradas, [["user-1", "proc-1", "lote"]]);
});

test("item já reivindicado por outra tentativa encerra sem reprocessar", async () => {
  reiniciar();
  estado.reivindicar = async () => null;
  const res = resposta();
  await handler(requisicao('{"itemId":"item-1"}'), res);
  assert.equal(res.statusCode, 204);
  assert.deepEqual(finalizados, []);
});

test("erro terminal marca falha e devolve 204 para o QStash não repetir", async () => {
  for (const terminal of ["alias_inexistente", "config_ausente"]) {
    reiniciar();
    estado.consultar = async () => { throw new Error(terminal); };
    const res = resposta();
    await handler(requisicao('{"itemId":"item-1"}'), res);
    assert.equal(res.statusCode, 204, terminal);
    assert.deepEqual(finalizados, [{ id: "item-1", status: "falhou", erro: terminal }]);
  }
});

test("erro transitório devolve 500 para o QStash tentar de novo", async () => {
  reiniciar();
  estado.consultar = async () => { throw new Error("tribunal_indisponivel"); };
  const res = resposta();
  await handler(requisicao('{"itemId":"item-1"}'), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "tribunal_indisponivel" });
  assert.deepEqual(finalizados, [{ id: "item-1", status: "falhou", erro: "tribunal_indisponivel" }]);
});

test("rate limit estourado falha o item sem chamar o DataJud", async () => {
  reiniciar();
  let consultou = 0;
  estado.limite = async () => ({ permitido: false });
  estado.consultar = async () => { consultou += 1; return {}; };
  const res = resposta();
  await handler(requisicao('{"itemId":"item-1"}'), res);
  assert.equal(consultou, 0);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(finalizados, [{ id: "item-1", status: "falhou", erro: "limite_excedido" }]);
});

test("corpo sem itemId é rejeitado antes de tocar o banco", async () => {
  reiniciar();
  let reivindicou = 0;
  estado.reivindicar = async () => { reivindicou += 1; return null; };
  const res = resposta();
  await handler(requisicao('{"outro":1}'), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "item_invalido" });
  assert.equal(reivindicou, 0);
});

test("método diferente de POST é recusado", async () => {
  reiniciar();
  const res = resposta();
  await handler(requisicao('{"itemId":"item-1"}', "GET"), res);
  assert.equal(res.statusCode, 405);
});
