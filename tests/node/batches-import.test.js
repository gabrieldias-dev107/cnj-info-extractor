import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { xlsxDeLote } from "../../server/xlsx.js";

const estado = { usuario: { id: "user-1" }, ssoLigado: true, publicar: async () => {} };
let criados = [];

mock.module("../../server/sso.js", { namedExports: { currentUser: async () => estado.usuario } });
mock.module("../../server/sso-config.js", { namedExports: { ssoConfigurado: () => estado.ssoLigado } });
mock.module("../../server/db.js", {
  namedExports: {
    createBatch: async (userId, itens) => {
      const criado = { id: "lote-1", expiraEm: "2026-09-01T00:00:00.000Z", itens: itens.map((item, i) => ({ ...item, id: "item-" + i })) };
      criados.push(criado);
      return criado;
    },
    finishBatchItem: async () => {},
  },
});
mock.module("../../server/queue.js", { namedExports: { publishBatchItem: (...args) => estado.publicar(...args) } });

const { default: handler } = await import("../../api/batches/import.js");

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NUMERO_A = "00013278820188260344";
const NUMERO_B = "00013278820188260352";

function resposta() {
  return {
    statusCode: null,
    body: undefined,
    status(codigo) { this.statusCode = codigo; return this; },
    json(valor) { this.body = valor; return this; },
    end() { return this; },
  };
}

function requisicao(conteudo, tipo) {
  const buffer = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, "utf8");
  const stream = (async function* () { yield buffer; })();
  stream.method = "POST";
  stream.headers = { host: "app.vercel.app", origin: "https://app.vercel.app", "content-type": tipo };
  return stream;
}

function reiniciar() {
  estado.usuario = { id: "user-1" };
  estado.ssoLigado = true;
  estado.publicar = async () => {};
  criados = [];
}

test("CSV é lido no servidor, com cabeçalho numero e delimitador ponto e vírgula", async () => {
  reiniciar();
  const res = resposta();
  await handler(requisicao("numero;observacao\r\n" + NUMERO_A + ";primeiro\r\n" + NUMERO_B + ";segundo\r\n", "text/csv"), res);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.total, 2);
  assert.deepEqual(criados[0].itens.map((item) => item.numero), [NUMERO_A, NUMERO_B]);
});

test("CSV sem cabeçalho usa a primeira coluna", async () => {
  reiniciar();
  const res = resposta();
  await handler(requisicao(NUMERO_A + "\n" + NUMERO_B + "\n", "text/csv"), res);
  assert.equal(res.statusCode, 202);
  assert.deepEqual(criados[0].itens.map((item) => item.numero), [NUMERO_A, NUMERO_B]);
});

test("CSV com campo entre aspas não quebra a linha no delimitador", async () => {
  reiniciar();
  const res = resposta();
  await handler(requisicao('numero,obs\n' + NUMERO_A + ',"contém, vírgula"\n', "text/csv"), res);
  assert.equal(res.statusCode, 202);
  assert.deepEqual(criados[0].itens.map((item) => item.numero), [NUMERO_A]);
});

test("XLSX continua funcionando pelo mesmo endpoint", async () => {
  reiniciar();
  const planilha = xlsxDeLote([{ linha: 1, numero: NUMERO_A, status: "pendente", erro: null, estagio: null }]);
  const res = resposta();
  await handler(requisicao(planilha, TIPO_XLSX), res);
  assert.equal(res.statusCode, 202);
  assert.deepEqual(criados[0].itens.map((item) => item.numero), [NUMERO_A]);
});

test("formato não declarado é recusado — o nome do arquivo nunca decide", async () => {
  reiniciar();
  const res = resposta();
  await handler(requisicao(NUMERO_A, "application/octet-stream"), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "formato_nao_suportado" });
});

test("CSV vazio responde csv_invalido", async () => {
  reiniciar();
  const res = resposta();
  await handler(requisicao("   \n  \n", "text/csv"), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "csv_invalido" });
});

test("arquivo acima de 2 MiB é cortado na leitura do corpo", async () => {
  reiniciar();
  const grande = Buffer.alloc(2 * 1024 * 1024 + 10, 0x31);
  const res = resposta();
  await handler(requisicao(grande, "text/csv"), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "arquivo_maior_que_2mb" });
});

test("import sem sessão responde 401 com dica de SSO", async () => {
  reiniciar();
  estado.usuario = null;
  const res = resposta();
  await handler(requisicao(NUMERO_A, "text/csv"), res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "autenticacao_necessaria", login: "sso" });
});
