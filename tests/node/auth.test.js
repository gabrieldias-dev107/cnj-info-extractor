import assert from "node:assert/strict";
import test from "node:test";

process.env.APP_ACCESS_PASSWORD = "senha-compartilhada-segura";
process.env.SESSION_SECRET = "segredo-de-sessao-com-pelo-menos-32-caracteres";

const { criarTokenSessao, senhaValida, sessaoValida } = await import("../../server/auth.js");

test("token HMAC expira em 8 horas e rejeita adulteração", () => {
  const token = criarTokenSessao(1_000);
  const req = { headers: { cookie: "cnj_session=" + token } };
  assert.equal(sessaoValida(req, 28_800_999), true);
  assert.equal(sessaoValida(req, 28_801_000), false);
  assert.equal(sessaoValida({ headers: { cookie: "cnj_session=" + token + "x" } }, 2_000), false);
});

test("configuração mínima e senha são validadas sem fallback", () => {
  assert.equal(senhaValida("senha-compartilhada-segura"), true);
  assert.equal(senhaValida("senha-incorreta"), false);
  const segredo = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "curto";
  assert.equal(criarTokenSessao(), null);
  process.env.SESSION_SECRET = segredo;
});
