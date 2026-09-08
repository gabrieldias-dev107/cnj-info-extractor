import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { request, response } from "./helpers/http.js";

process.env.SESSION_SECRET = "segredo-de-sessao-com-pelo-menos-32-caracteres";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN_ID = "11111111-1111-4111-8111-111111111111";

const estado = {};
const registros = {};

function reiniciar() {
  estado.usuario = { id: USER_ID, email: "criador@btblue.com.br" };
  estado.ssoLigado = true;
  estado.tokens = [{
    id: TOKEN_ID, nome: "integração", prefixo: "abcdefgh", limite_dia: 500,
    criado_em: "2026-09-08T00:00:00.000Z", ultimo_uso_em: null, revogado_em: null, expires_at: "2027-03-07T00:00:00.000Z",
  }];
  estado.criado = {
    id: TOKEN_ID, nome: "integração", prefixo: "abcdefgh", limite_dia: 500,
    criado_em: "2026-09-08T00:00:00.000Z", ultimo_uso_em: null, revogado_em: null, expires_at: "2027-03-07T00:00:00.000Z",
    token: "cnjsvc_abcdefgh_" + "z".repeat(43),
  };
  estado.revogado = { id: TOKEN_ID, prefixo: "abcdefgh" };
  estado.trilha = {
    eventos: [{
      id: "evt-1", actor_type: "token", ator_rotulo: "t_abcdefgh", acao: "api_v1", recurso: "processos",
      resultado: "sucesso_cache", process_id: "proc-1", service_token_id: TOKEN_ID, req_id: "req-1",
      created_at: "2026-09-08T10:00:00.000Z",
    }],
    total: 1,
  };
  registros.chamadas = [];
  registros.auditoria = [];
}
reiniciar();

mock.module("../../server/sso.js", { namedExports: { currentUser: async () => estado.usuario } });
mock.module("../../server/sso-config.js", { namedExports: { ssoConfigurado: () => estado.ssoLigado } });
mock.module("../../server/db.js", {
  namedExports: {
    createServiceToken: async (...args) => { registros.chamadas.push(["createServiceToken", ...args]); return estado.criado; },
    serviceTokensForCreator: async (...args) => { registros.chamadas.push(["serviceTokensForCreator", ...args]); return estado.tokens; },
    revokeServiceTokenForCreator: async (...args) => { registros.chamadas.push(["revokeServiceTokenForCreator", ...args]); return estado.revogado; },
    auditEventsForUser: async (...args) => { registros.chamadas.push(["auditEventsForUser", ...args]); return estado.trilha; },
    recordAuditEvent: async (evento) => { registros.auditoria.push(evento); },
  },
});

const { default: tokens } = await import("../../server/handlers/service-tokens.js");
const { default: trilha } = await import("../../server/handlers/audit.js");

const headers = { host: "app.vercel.app", origin: "https://app.vercel.app" };

// O helper compartilhado não carrega query string; estas rotas leem `id`,
// `limite` e `offset` de lá.
function req({ query, ...opcoes } = {}) {
  return Object.assign(request(Object.assign({ headers }, opcoes)), { query: query || {} });
}

test("emissão devolve o valor do token uma única vez e a listagem nunca o repete", async () => {
  reiniciar();
  const criar = response();
  await tokens(req({ method: "POST", body: { nome: "integração", limiteDia: 500 } }), criar);

  assert.equal(criar.statusCode, 201);
  assert.equal(criar.body.token, estado.criado.token);
  assert.equal(criar.body.prefixo, "abcdefgh");
  assert.deepEqual(registros.chamadas[0], ["createServiceToken", USER_ID, { nome: "integração", limiteDia: 500 }]);

  const listar = response();
  await tokens(req({ method: "GET" }), listar);
  assert.equal(listar.statusCode, 200);
  assert.deepEqual(listar.body.tokens, [{
    id: TOKEN_ID, nome: "integração", prefixo: "abcdefgh", limiteDia: 500,
    criadoEm: "2026-09-08T00:00:00.000Z", ultimoUsoEm: null, revogadoEm: null, expiresAt: "2027-03-07T00:00:00.000Z",
  }]);
  assert.equal(JSON.stringify(listar.body).includes(estado.criado.token), false, "o segredo não pode reaparecer na listagem");
});

test("emissão e revogação entram na trilha pelo prefixo, nunca pelo segredo", async () => {
  reiniciar();
  await tokens(req({ method: "POST", body: { nome: "integração" } }), response());
  await tokens(req({ method: "DELETE", query: { id: TOKEN_ID } }), response());

  assert.deepEqual(registros.auditoria.map((evento) => [evento.acao, evento.resultado, evento.recurso]), [
    ["service_token_emitido", "sucesso", "t_abcdefgh"],
    ["service_token_revogado", "sucesso", "t_abcdefgh"],
  ]);
  assert.equal(JSON.stringify(registros.auditoria).includes(estado.criado.token), false);
});

test("token de outro criador é indistinguível de inexistente", async () => {
  reiniciar();
  estado.revogado = null;
  const res = response();
  await tokens(req({ method: "DELETE", query: { id: TOKEN_ID } }), res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "token_nao_encontrado" });
  // O escopo é do SQL: o handler passa sempre o próprio usuário.
  assert.deepEqual(registros.chamadas[0], ["revokeServiceTokenForCreator", TOKEN_ID, USER_ID]);
  assert.deepEqual(registros.auditoria.map((evento) => evento.resultado), ["negado_nao_encontrado"]);
});

test("nome vazio, nome longo demais e limite fora da faixa são recusados antes do banco", async () => {
  reiniciar();
  for (const body of [{ nome: "" }, { nome: "x".repeat(121) }]) {
    const res = response();
    await tokens(req({ method: "POST", body }), res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "nome_invalido" });
  }

  for (const limiteDia of [0, -1, 1.5, "500", 10001]) {
    const res = response();
    await tokens(req({ method: "POST", body: { nome: "n", limiteDia } }), res);
    assert.equal(res.statusCode, 400, "limite inválido: " + String(limiteDia));
    assert.deepEqual(res.body, { error: "limite_invalido" });
  }
  assert.deepEqual(registros.chamadas, []);
});

test("id de token malformado não chega ao banco", async () => {
  reiniciar();
  const res = response();
  await tokens(req({ method: "DELETE", query: { id: "nao-e-uuid" } }), res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "token_invalido" });
  assert.deepEqual(registros.chamadas, []);
});

// Mecanismo único por rota: um token de serviço não pode emitir nem revogar
// outro token — senão um vazamento se autorrenovaria.
test("rotas de sessão recusam Authorization: Bearer", async () => {
  reiniciar();
  const comBearer = Object.assign({}, headers, { authorization: "Bearer cnjsvc_abcdefgh_" + "z".repeat(43) });

  for (const [nome, handler, opcoes] of [
    ["service-tokens", tokens, { method: "GET", headers: comBearer }],
    ["audit", trilha, { method: "GET", headers: comBearer }],
  ]) {
    const res = response();
    await handler(request(opcoes), res);
    assert.equal(res.statusCode, 401, nome);
    assert.deepEqual(res.body, { error: "autenticacao_necessaria", login: "sso" }, nome);
  }
  assert.deepEqual(registros.chamadas, [], "nada é lido do banco por Bearer");
});

test("rotas de token e trilha preservam origem e sessão SSO", async () => {
  reiniciar();
  for (const handler of [tokens, trilha]) {
    const cruzada = response();
    await handler(request({ method: "GET", headers: { host: "app.vercel.app", origin: "https://outro.example" } }), cruzada);
    assert.equal(cruzada.statusCode, 403);
    assert.deepEqual(cruzada.body, { error: "origem_nao_permitida" });
  }

  estado.usuario = null;
  for (const handler of [tokens, trilha]) {
    const semSessao = response();
    await handler(req({ method: "GET" }), semSessao);
    assert.equal(semSessao.statusCode, 401);
    assert.deepEqual(semSessao.body, { error: "autenticacao_necessaria", login: "sso" });
  }
});

test("trilha devolve só os eventos do próprio usuário, paginados", async () => {
  reiniciar();
  const res = response();
  await trilha(req({ method: "GET", query: { limite: "10", offset: "20" } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(registros.chamadas[0], ["auditEventsForUser", USER_ID, { limite: 10, offset: 20 }]);
  assert.deepEqual(res.body, {
    eventos: [{
      id: "evt-1", ator: "t_abcdefgh", atorTipo: "token", acao: "api_v1", recurso: "processos",
      resultado: "sucesso_cache", processId: "proc-1", serviceTokenId: TOKEN_ID, reqId: "req-1",
      createdAt: "2026-09-08T10:00:00.000Z",
    }],
    total: 1,
    limite: 10,
    offset: 20,
  });
});

test("paginação da trilha é limitada: fora da faixa é aparado, ilegível cai no padrão", async () => {
  reiniciar();
  const casos = [["500", 200], ["0", 1], ["abc", 50], [undefined, 50], ["", 50]];

  for (const [entrada, esperado] of casos) {
    registros.chamadas.length = 0;
    await trilha(req({ method: "GET", query: { limite: entrada } }), response());
    assert.equal(registros.chamadas[0][2].limite, esperado, "limite " + String(entrada));
  }

  registros.chamadas.length = 0;
  await trilha(req({ method: "GET", query: { offset: "-5" } }), response());
  assert.equal(registros.chamadas[0][2].offset, 0, "offset negativo não vira SQL");
});

test("método não previsto é recusado nas duas rotas", async () => {
  reiniciar();
  const patchToken = response();
  await tokens(req({ method: "PATCH", body: {} }), patchToken);
  assert.equal(patchToken.statusCode, 405);

  const postTrilha = response();
  await trilha(req({ method: "POST", body: {} }), postTrilha);
  assert.equal(postTrilha.statusCode, 405);
});

test("falha do banco vira 503 com código próprio, não 500 genérico", async () => {
  reiniciar();
  const anterior = estado.tokens;
  estado.tokens = null;
  const listar = response();
  await tokens(req({ method: "GET" }), listar);
  assert.equal(listar.statusCode, 503);
  assert.deepEqual(listar.body, { error: "token_indisponivel" });
  estado.tokens = anterior;

  estado.trilha = null;
  const lerTrilha = response();
  await trilha(req({ method: "GET" }), lerTrilha);
  assert.equal(lerTrilha.statusCode, 503);
  assert.deepEqual(lerTrilha.body, { error: "auditoria_indisponivel" });
});

test("nem token nem trilha podem ser cacheados por intermediário", async () => {
  reiniciar();
  for (const handler of [tokens, trilha]) {
    const res = response();
    await handler(req({ method: "GET" }), res);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
});

// --- achados da revisão Codex -----------------------------------------------

// Origem cruzada, ausência de sessão e Bearer em rota de cookie são tentativas
// de acesso, e o P2 exige registrar as negativas. Antes só o 404 da revogação
// entrava na trilha.
test("recusa por origem, por sessão e por Bearer entram na trilha como negativas", async () => {
  const comBearer = Object.assign({}, headers, { authorization: "Bearer cnjsvc_abcdefgh_" + "z".repeat(43) });

  const casos = [
    ["negado_origem", { method: "GET", headers: { host: "app.vercel.app", origin: "https://outro.example" } }, null],
    ["negado_bearer_em_rota_de_sessao", { method: "GET", headers: comBearer }, null],
    ["negado_sem_sessao", { method: "GET", headers }, "semUsuario"],
  ];

  for (const [esperado, opcoes, semUsuario] of casos) {
    for (const [rota, handler, acao] of [["tokens", tokens, "service_tokens"], ["audit", trilha, "trilha_auditoria"]]) {
      reiniciar();
      if (semUsuario) estado.usuario = null;
      await handler(request(opcoes), response());

      assert.deepEqual(registros.auditoria.map((evento) => evento.resultado), [esperado], rota + " / " + esperado);
      assert.equal(registros.auditoria[0].acao, acao);
      // Identidade ainda não estabelecida: ator anônimo, sem user_id.
      assert.equal(registros.auditoria[0].actorType, "usuario");
      assert.equal(registros.auditoria[0].userId, null);
      assert.equal(registros.auditoria[0].atorRotulo, "anonimo");
      assert.deepEqual(registros.chamadas, [], "nada é lido do banco numa recusa");
    }
  }
});

test("corpo JSON nulo não derruba a emissão de token", async () => {
  reiniciar();
  const req = Object.assign(request({ method: "POST", headers }), { query: {} });
  req.body = "null";
  const res = response();

  await tokens(req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "nome_invalido" });
  assert.deepEqual(registros.chamadas, []);
});
