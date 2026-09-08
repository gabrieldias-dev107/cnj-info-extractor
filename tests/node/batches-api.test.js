import assert from "node:assert/strict";
import test, { mock } from "node:test";

const estado = {
  usuario: { id: "user-1", email: "alguem@btblue.com.br" },
  ssoLigado: true,
  lote: { id: "lote-1", status: "concluido", total: 2, contagens: { concluido: 2 } },
  itens: [
    { linha: 1, numero: "00013278820188260344", status: "concluido", erro: null, estagio: "expedicao_alvara" },
    { linha: 2, numero: "00013278820188260345", status: "invalido", erro: "numero_invalido", estagio: null },
  ],
  publicar: async () => {},
};
const finalizados = [];
const auditoria = [];
let lotesCriados = [];

mock.module("../../server/sso.js", { namedExports: { currentUser: async () => estado.usuario } });
mock.module("../../server/sso-config.js", { namedExports: { ssoConfigurado: () => estado.ssoLigado } });
mock.module("../../server/db.js", {
  namedExports: {
    batchForUser: async () => estado.lote,
    batchItemsForUser: async () => estado.itens,
    createBatch: async (userId, itens) => {
      const criado = {
        id: "lote-novo",
        expiraEm: "2026-09-01T00:00:00.000Z",
        itens: itens.map((item, indice) => ({ ...item, id: "item-" + indice })),
      };
      lotesCriados.push({ userId, criado });
      return criado;
    },
    finishBatchItem: async (id, dados) => { finalizados.push({ id, ...dados }); },
    recordAuditEvent: async (evento) => { auditoria.push(evento); },
  },
});
mock.module("../../server/queue.js", { namedExports: { publishBatchItem: (...args) => estado.publicar(...args) } });

const { default: index } = await import("../../api/batches/index.js");
const { default: exportar } = await import("../../api/batches/export.js");

const NUMERO_A = "00013278820188260344";
const headers = { host: "app.vercel.app", origin: "https://app.vercel.app" };

function resposta() {
  return {
    statusCode: null,
    body: undefined,
    headers: new Map(),
    setHeader(nome, valor) { this.headers.set(nome.toLowerCase(), valor); },
    status(codigo) { this.statusCode = codigo; return this; },
    json(valor) { this.body = valor; return this; },
    send(valor) { this.body = valor; return this; },
    end() { return this; },
  };
}

function reiniciar() {
  estado.usuario = { id: "user-1", email: "alguem@btblue.com.br" };
  estado.ssoLigado = true;
  estado.publicar = async () => {};
  finalizados.length = 0;
  lotesCriados = [];
  auditoria.length = 0;
}

test("sem sessão as rotas de lote respondem 401 com dica de SSO", async () => {
  reiniciar();
  estado.usuario = null;
  for (const [nome, handler, req] of [
    ["GET status", index, { method: "GET", headers, query: { id: "lote-1" } }],
    ["POST criar", index, { method: "POST", headers, body: { numeros: [NUMERO_A] } }],
    ["GET export", exportar, { method: "GET", headers, query: { id: "lote-1" } }],
  ]) {
    const res = resposta();
    await handler(req, res);
    assert.equal(res.statusCode, 401, nome);
    // Sem este campo o cliente mostra erro genérico em vez de ir ao Entra.
    assert.deepEqual(res.body, { error: "autenticacao_necessaria", login: "sso" }, nome);
  }
});

test("origem cruzada é bloqueada antes de tocar o banco", async () => {
  reiniciar();
  const res = resposta();
  await index({ method: "GET", headers: { host: "app.vercel.app", origin: "https://outro.example" }, query: { id: "lote-1" } }, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "origem_nao_permitida" });
});

test("sem SSO configurado a triagem em lote fica indisponível", async () => {
  reiniciar();
  estado.ssoLigado = false;
  const res = resposta();
  await index({ method: "GET", headers, query: { id: "lote-1" } }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "autenticacao_indisponivel" });
});

test("status do lote devolve a triagem por linha com o estágio", async () => {
  reiniciar();
  const res = resposta();
  await index({ method: "GET", headers, query: { id: "lote-1" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 2);
  assert.deepEqual(res.body.itens.map((item) => item.estagio), ["expedicao_alvara", null]);
});

test("lote de outro usuário responde 404, não vaza existência", async () => {
  reiniciar();
  const anterior = estado.lote;
  estado.lote = null;
  const res = resposta();
  await index({ method: "GET", headers, query: { id: "lote-de-outro" } }, res);
  estado.lote = anterior;
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "lote_nao_encontrado" });
});

test("criação enfileira os pendentes e devolve 202", async () => {
  reiniciar();
  const publicados = [];
  estado.publicar = async (id) => { publicados.push(id); };
  const res = resposta();
  await index({ method: "POST", headers, body: { numeros: [NUMERO_A, NUMERO_A, "123"] } }, res);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.total, 3);
  // Só o primeiro é pendente: o segundo é duplicado e o terceiro inválido.
  assert.equal(publicados.length, 1);
  assert.deepEqual(finalizados, []);
});

test("falha ao publicar marca o item como fila_indisponivel", async () => {
  reiniciar();
  estado.publicar = async () => { throw new Error("fila_indisponivel"); };
  const res = resposta();
  await index({ method: "POST", headers, body: { numeros: [NUMERO_A] } }, res);
  assert.equal(res.statusCode, 202);
  assert.deepEqual(finalizados, [{ id: "item-0", status: "falhou", erro: "fila_indisponivel" }]);
});

test("lote acima de 500 números é recusado com 400", async () => {
  reiniciar();
  const res = resposta();
  await index({ method: "POST", headers, body: { numeros: new Array(501).fill(NUMERO_A) } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "lote_maior_que_500" });
});

test("export entrega CSV por padrão e XLSX sob demanda", async () => {
  reiniciar();
  const csv = resposta();
  await exportar({ method: "GET", headers, query: { id: "lote-1" } }, csv);
  assert.equal(csv.statusCode, 200);
  assert.equal(csv.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(csv.headers.get("content-disposition"), /triagem-lote-1\.csv/);
  assert.equal(csv.headers.get("cache-control"), "no-store");
  assert.match(String(csv.body), /expedicao_alvara/);

  const xlsx = resposta();
  await exportar({ method: "GET", headers, query: { id: "lote-1", formato: "xlsx" } }, xlsx);
  assert.equal(xlsx.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.match(xlsx.headers.get("content-disposition"), /triagem-lote-1\.xlsx/);
  assert.ok(Buffer.isBuffer(xlsx.body) || xlsx.body instanceof Uint8Array);
});

test("nome do arquivo exportado não aceita id com caracteres de escape", async () => {
  reiniciar();
  const res = resposta();
  await exportar({ method: "GET", headers, query: { id: 'lote"; drop' } }, res);
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="triagem-lotedrop.csv"');
});

// A exportação é a maior saída de dado processual do sistema: um arquivo com
// até 500 números deixa a ferramenta e passa a viver fora dela.
test("exportação de lote entra na trilha, com formato e com a recusa", async () => {
  reiniciar();
  await exportar({ method: "GET", headers, query: { id: "lote-1" } }, resposta());
  await exportar({ method: "GET", headers, query: { id: "lote-1", formato: "xlsx" } }, resposta());

  assert.deepEqual(auditoria.map((evento) => [evento.acao, evento.resultado, evento.recurso]), [
    ["lote_exportado", "sucesso", "batch:lote-1:csv"],
    ["lote_exportado", "sucesso", "batch:lote-1:xlsx"],
  ]);
  assert.equal(auditoria[0].userId, "user-1");
  assert.equal(auditoria[0].atorRotulo.startsWith("u_"), true, "o ator é pseudonimizado");
  assert.equal(JSON.stringify(auditoria).includes(NUMERO_A), false, "o número CNJ não entra na trilha");

  reiniciar();
  const anterior = estado.lote;
  estado.lote = null;
  const negado = resposta();
  await exportar({ method: "GET", headers, query: { id: "lote-de-outro" } }, negado);
  estado.lote = anterior;
  assert.equal(negado.statusCode, 404);
  assert.deepEqual(auditoria.map((evento) => evento.resultado), ["negado_nao_encontrado"]);
});
