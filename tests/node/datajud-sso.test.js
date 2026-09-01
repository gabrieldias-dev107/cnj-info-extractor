import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { jsonResponse, request, response } from "./helpers/http.js";

// O datajud.test.js exercita o modo de senha compartilhada (SSO desligado).
// Aqui o SSO está ligado, que é o caminho onde vivem o cache do servidor e a
// dica de login — os dois defeitos que o QA de Preview encontrou.
process.env.DATAJUD_API_KEY = "chave-de-teste";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-teste";
process.env.SESSION_SECRET = "segredo-de-sessao-com-pelo-menos-32-caracteres";
process.env.M365_TENANT_ID = "tenant";
process.env.M365_CLIENT_ID = "client";
process.env.M365_CLIENT_SECRET = "secret";
process.env.DATABASE_URL = "postgres://fake/fake";

const estado = {
  usuario: async () => ({ id: "user-1", email: "alguem@btblue.com.br" }),
  emCache: async () => null,
};
const persistidos = [];
const consultasRegistradas = [];

mock.module("../../server/sso.js", { namedExports: { currentUser: (...args) => estado.usuario(...args) } });
mock.module("../../server/db.js", {
  namedExports: {
    freshSnapshot: (...args) => estado.emCache(...args),
    persistSnapshot: async (dados) => { persistidos.push(dados); return { snapshotId: "snap-1", processId: "proc-1", estagio: { estagio: "nao_classificado", codigo: null, data: null, idadeDias: null, versao: "tpu-teste" } }; },
    recordConsultation: async (...args) => { consultasRegistradas.push(args); },
  },
});

const { default: handler } = await import("../../api/datajud.js");

const NUMERO = "00013278820188260344";

function requisicao(corpo) {
  return request({ headers: { host: "app.vercel.app", origin: "https://app.vercel.app" }, body: corpo });
}

async function executar({ req = requisicao({ numero: NUMERO }), fetchImpl = async () => jsonResponse(200, { hits: { hits: [] } }) } = {}) {
  const anteriorFetch = globalThis.fetch;
  const anteriorLog = console.log;
  const anteriorErro = console.error;
  globalThis.fetch = fetchImpl;
  console.log = () => {};
  console.error = () => {};
  const res = response();
  try {
    await handler(req, res);
    return res;
  } finally {
    globalThis.fetch = anteriorFetch;
    console.log = anteriorLog;
    console.error = anteriorErro;
  }
}

function reiniciar() {
  persistidos.length = 0;
  consultasRegistradas.length = 0;
  estado.usuario = async () => ({ id: "user-1", email: "alguem@btblue.com.br" });
  estado.emCache = async () => null;
}

// Regressão do BUG-4: sem a dica de login o cliente caía no diálogo de senha
// compartilhada, que não tem como concluir o acesso quando o SSO está ligado.
test("401 com SSO ligado carrega login:\"sso\"", async () => {
  reiniciar();
  estado.usuario = async () => null;
  const res = await executar();
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "autenticacao_necessaria", login: "sso" });
});

// Regressão do BUG-5: a classificação some da resposta assim que o cache passa
// a responder — ou seja, em quase toda consulta real dentro do TTL.
test("resposta do cache preserva o estágio TPU", async () => {
  reiniciar();
  const estagio = { estagio: "expedicao_alvara", codigo: 12548, data: "2026-08-01T00:00:00.000Z", idadeDias: 26, versao: "tpu-teste" };
  estado.emCache = async () => ({ id: "snap-antigo", processId: "proc-antigo", dados: { encontrado: true, total: 1, processos: [{ numeroProcesso: NUMERO }] }, estagio });

  let chamouDatajud = 0;
  const res = await executar({ fetchImpl: async () => { chamouDatajud += 1; return jsonResponse(200, { hits: { hits: [] } }); } });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cache, "servidor");
  assert.deepEqual(res.body.estagio, estagio);
  assert.equal(res.body.total, 1, "o conteúdo do snapshot continua vindo junto");
  assert.equal(chamouDatajud, 0, "cache fresco não vai à rede");
});

test("resposta fresca e resposta de cache têm o mesmo formato de estágio", async () => {
  reiniciar();
  const fresca = await executar();
  assert.equal(fresca.statusCode, 200);

  reiniciar();
  estado.emCache = async () => ({ id: "s", processId: "p", dados: { encontrado: false, total: 0, processos: [] }, estagio: { estagio: "nao_classificado", codigo: null, data: null, idadeDias: null, versao: "tpu-teste" } });
  const cacheada = await executar();

  assert.deepEqual(Object.keys(fresca.body.estagio).sort(), Object.keys(cacheada.body.estagio).sort());
});

// Sem o identificador do processo na resposta, quem consulta um número não tem
// como incluí-lo numa carteira: `POST /api/portfolios/items` exige o processId,
// e nenhuma outra rota o devolve. As três saídas de sucesso precisam levá-lo,
// inclusive a do cache do servidor — que é a que responde quase sempre.
test("resposta de sucesso com SSO ligado carrega o processId do processo", async () => {
  reiniciar();
  const vazia = await executar();
  assert.equal(vazia.statusCode, 200);
  assert.equal(vazia.body.encontrado, false);
  assert.equal(vazia.body.processId, "proc-1");

  reiniciar();
  const achada = await executar({
    fetchImpl: async () => jsonResponse(200, { hits: { hits: [{ _source: { numeroProcesso: NUMERO, grau: "G1", movimentos: [] } }] } }),
  });
  assert.equal(achada.body.encontrado, true);
  assert.equal(achada.body.processId, "proc-1");

  reiniciar();
  estado.emCache = async () => ({
    id: "snap-antigo",
    processId: "proc-do-cache",
    dados: { encontrado: true, total: 1, processos: [{ numeroProcesso: NUMERO }] },
    estagio: { estagio: "nao_classificado", codigo: null, data: null, idadeDias: null, versao: "tpu-teste" },
  });
  const cacheada = await executar();
  assert.equal(cacheada.body.cache, "servidor");
  assert.equal(cacheada.body.processId, "proc-do-cache", "o cache do servidor não pode esconder o identificador");
});

test("alias forjado é recusado antes de qualquer rede, mesmo com sessão SSO", async () => {
  reiniciar();
  let chamadas = 0;
  const res = await executar({
    req: requisicao({ numero: NUMERO, alias: "api_publica_trf1" }),
    fetchImpl: async () => { chamadas += 1; return jsonResponse(200, {}); },
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "alias_invalido" });
  assert.equal(chamadas, 0);
  assert.deepEqual(persistidos, [], "nada é gravado com o alias forjado");
});

test("o alias persistido é o derivado, não o que veio do cliente", async () => {
  reiniciar();
  await executar({ req: requisicao({ numero: NUMERO, alias: "api_publica_tjsp" }) });
  assert.equal(persistidos.length, 1);
  assert.equal(persistidos[0].alias, "api_publica_tjsp");
  assert.deepEqual(consultasRegistradas, [["user-1", "proc-1", "unitaria"]]);
});
