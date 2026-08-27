import assert from "node:assert/strict";
import test, { mock } from "node:test";

// Estes dois handlers ficaram quebrados por importarem "../../../server/sso.js".
// Além do comportamento, o teste garante que eles continuem carregáveis.
const estado = {
  iniciar: async () => ({ url: "https://login.microsoftonline.com/autorizar", cookie: "cnj_oidc=v1.abc; HttpOnly" }),
  concluir: async () => ({ cookie: "cnj_sso=token; HttpOnly", user: { id: "user-1" } }),
};

mock.module("../../server/sso.js", {
  namedExports: {
    startLogin: (...args) => estado.iniciar(...args),
    finishLogin: (...args) => estado.concluir(...args),
  },
});

const { default: login } = await import("../../api/auth/login.js");
const { default: callback } = await import("../../api/auth/callback.js");

function resposta() {
  return {
    statusCode: null,
    body: undefined,
    redirecionou: null,
    headers: new Map(),
    setHeader(nome, valor) { this.headers.set(nome.toLowerCase(), valor); },
    status(codigo) { this.statusCode = codigo; return this; },
    json(valor) { this.body = valor; return this; },
    redirect(codigo, url) { this.statusCode = codigo; this.redirecionou = url; return this; },
  };
}

const req = { headers: { host: "app.vercel.app", "x-forwarded-proto": "https" } };

test("login redireciona ao Entra e planta o cookie de state", async () => {
  const res = resposta();
  await login(req, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.redirecionou, "https://login.microsoftonline.com/autorizar");
  assert.match(res.headers.get("set-cookie"), /^cnj_oidc=/);
});

test("login indisponível responde 503 em vez de quebrar", async () => {
  const anterior = estado.iniciar;
  estado.iniciar = async () => { throw new Error("autenticacao_indisponivel"); };
  const res = resposta();
  try { await login(req, res); } finally { estado.iniciar = anterior; }
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "autenticacao_indisponivel" });
});

test("callback troca o código, limpa o cookie temporário e volta para a raiz", async () => {
  const res = resposta();
  await callback({ ...req, query: { code: "codigo", state: "state" } }, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.redirecionou, "/");
  const cookies = res.headers.get("set-cookie");
  assert.match(cookies[0], /^cnj_sso=/);
  assert.match(cookies[1], /^cnj_oidc=;/);
  assert.match(cookies[1], /Max-Age=0/);
});

test("conta fora da política recebe 403 e state inválido recebe 401", async () => {
  const anterior = estado.concluir;
  try {
    estado.concluir = async () => { throw new Error("acesso_nao_permitido"); };
    const proibido = resposta();
    await callback({ ...req, query: {} }, proibido);
    assert.equal(proibido.statusCode, 403);
    assert.deepEqual(proibido.body, { error: "acesso_nao_permitido" });

    estado.concluir = async () => { throw new Error("autenticacao_invalida"); };
    const invalido = resposta();
    await callback({ ...req, query: {} }, invalido);
    assert.equal(invalido.statusCode, 401);
    assert.deepEqual(invalido.body, { error: "autenticacao_invalida" });
  } finally {
    estado.concluir = anterior;
  }
});
