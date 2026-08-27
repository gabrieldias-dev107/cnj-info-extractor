import assert from "node:assert/strict";
import test from "node:test";
import { jsonResponse, request, response } from "./helpers/http.js";

process.env.APP_ACCESS_PASSWORD = "senha-compartilhada-segura";
process.env.SESSION_SECRET = "segredo-de-sessao-com-pelo-menos-32-caracteres";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "token";

const { default: handler } = await import("../../api/session.js");

async function executar(req, fetchImpl = async () => jsonResponse(200, [{ result: 1 }, { result: 1 }])) {
  const anterior = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const res = response();
  try { await handler(req, res); return res; } finally { globalThis.fetch = anterior; }
}

const headers = { host: "app.vercel.app", origin: "https://app.vercel.app", "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.4" };

test("POST cria cookie seguro e GET valida sessão", async () => {
  const login = await executar(request({ headers, body: { senha: process.env.APP_ACCESS_PASSWORD } }));
  assert.equal(login.statusCode, 204);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /^cnj_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api/);
  assert.match(cookie, /Max-Age=28800/);
  assert.match(cookie, /Secure/);

  const sessao = await executar(request({ method: "GET", headers: { ...headers, cookie: cookie.split(";")[0] } }));
  assert.equal(sessao.statusCode, 204);
});

test("senha inválida, cookie adulterado e origem externa são recusados", async () => {
  assert.equal((await executar(request({ headers, body: { senha: "incorreta" } }))).statusCode, 401);
  assert.equal((await executar(request({ method: "GET", headers: { ...headers, cookie: "cnj_session=v1.1.x.invalida" } }))).statusCode, 401);
  let chamadas = 0;
  const externa = await executar(request({ headers: { ...headers, origin: "https://externo.example" }, body: { senha: process.env.APP_ACCESS_PASSWORD } }), async () => { chamadas += 1; return jsonResponse(200, []); });
  assert.equal(externa.statusCode, 403);
  assert.equal(chamadas, 0);
});

test("login falha fechado sem Redis e DELETE expira cookie", async () => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  const indisponivel = await executar(request({ headers, body: { senha: process.env.APP_ACCESS_PASSWORD } }));
  process.env.UPSTASH_REDIS_REST_URL = url;
  assert.equal(indisponivel.statusCode, 503);
  assert.deepEqual(indisponivel.body, { error: "autenticacao_indisponivel" });

  const logout = await executar(request({ method: "DELETE", headers }));
  assert.equal(logout.statusCode, 204);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
});
