import assert from "node:assert/strict";
import test, { mock } from "node:test";

process.env.M365_TENANT_ID = "tenant-corporativo";
process.env.M365_CLIENT_ID = "client-id";
process.env.M365_CLIENT_SECRET = "client-secret";
process.env.SESSION_SECRET = "segredo-de-sessao-com-pelo-menos-32-caracteres";
process.env.DATABASE_URL = "postgres://exemplo/neon";
process.env.APP_BASE_URL = "https://app.vercel.app";

const estado = {
  claims: { tid: "tenant-corporativo", oid: "oid-1", preferred_username: "Alguem@BTBlue.com.br" },
  usuario: { id: "user-1", email: "alguem@btblue.com.br" },
};
const sessoesCriadas = [];
const sessoesApagadas = [];
let urlPedida = null;
let trocaPedida = null;

class ConfidentialClientApplicationFake {
  constructor(config) { this.config = config; }
  async getAuthCodeUrl(pedido) {
    urlPedida = pedido;
    return "https://login.microsoftonline.com/tenant-corporativo/oauth2/v2.0/authorize";
  }
  async acquireTokenByCode(pedido) {
    trocaPedida = pedido;
    return { idTokenClaims: estado.claims };
  }
}

mock.module("@azure/msal-node", { namedExports: { ConfidentialClientApplication: ConfidentialClientApplicationFake } });
mock.module("../../server/db.js", {
  namedExports: {
    createSession: async (userId, token, expiraEm) => { sessoesCriadas.push({ userId, token, expiraEm }); },
    deleteSession: async (token) => { sessoesApagadas.push(token); },
    userForSession: async (token) => (token === "token-valido" ? estado.usuario : null),
    upsertUser: async () => estado.usuario,
  },
});

const { criarStateCookie, currentUser, finishLogin, logout, startLogin } = await import("../../server/sso.js");

const req = { headers: { host: "app.vercel.app", "x-forwarded-proto": "https" } };

function comCookie(valor) {
  return { headers: { ...req.headers, cookie: valor } };
}

function reiniciar() {
  estado.claims = { tid: "tenant-corporativo", oid: "oid-1", preferred_username: "Alguem@BTBlue.com.br" };
  sessoesCriadas.length = 0;
  sessoesApagadas.length = 0;
}

// Reproduz o par (cookie assinado, state) que o callback espera receber.
async function iniciar() {
  const login = await startLogin(req);
  return { cookie: login.cookie.split(";")[0], state: urlPedida.state };
}

test("startLogin usa PKCE S256 e assina o cookie de state", async () => {
  reiniciar();
  const login = await startLogin(req);
  assert.equal(urlPedida.codeChallengeMethod, "S256");
  assert.ok(urlPedida.codeChallenge);
  assert.equal(urlPedida.redirectUri, "https://app.vercel.app/api/auth/callback");
  assert.match(login.cookie, /^cnj_oidc=v1\./);
  assert.match(login.cookie, /HttpOnly/);
  assert.match(login.cookie, /SameSite=Lax/);
  assert.match(login.cookie, /Secure/);
});

test("login válido cria sessão de 8 horas e cookie próprio", async () => {
  reiniciar();
  const { cookie, state } = await iniciar();
  const resultado = await finishLogin(comCookie(cookie), { code: "codigo", state });
  assert.equal(sessoesCriadas.length, 1);
  assert.match(resultado.cookie, /^cnj_sso=/);
  assert.match(resultado.cookie, /Max-Age=28800/);
  assert.ok(trocaPedida.codeVerifier, "o verifier do PKCE precisa voltar na troca");
});

test("conta de outro tenant é recusada mesmo com state correto", async () => {
  reiniciar();
  const { cookie, state } = await iniciar();
  estado.claims = { ...estado.claims, tid: "outro-tenant" };
  await assert.rejects(
    () => finishLogin(comCookie(cookie), { code: "codigo", state }),
    /acesso_nao_permitido/
  );
  assert.equal(sessoesCriadas.length, 0);
});

test("e-mail fora do domínio permitido é recusado", async () => {
  reiniciar();
  const { cookie, state } = await iniciar();
  estado.claims = { ...estado.claims, preferred_username: "alguem@gmail.com" };
  await assert.rejects(
    () => finishLogin(comCookie(cookie), { code: "codigo", state }),
    /acesso_nao_permitido/
  );
});

test("token sem claim oid é recusado", async () => {
  reiniciar();
  const { cookie, state } = await iniciar();
  estado.claims = { tid: "tenant-corporativo", preferred_username: "alguem@btblue.com.br" };
  await assert.rejects(
    () => finishLogin(comCookie(cookie), { code: "codigo", state }),
    /acesso_nao_permitido/
  );
});

test("state divergente do cookie é rejeitado antes de trocar o código", async () => {
  reiniciar();
  const { cookie } = await iniciar();
  await assert.rejects(
    () => finishLogin(comCookie(cookie), { code: "codigo", state: "state-forjado" }),
    /autenticacao_invalida/
  );
});

test("cookie de state com assinatura adulterada é rejeitado", async () => {
  reiniciar();
  const { cookie, state } = await iniciar();
  const adulterado = cookie.slice(0, -4) + "AAAA";
  await assert.rejects(
    () => finishLogin(comCookie(adulterado), { code: "codigo", state }),
    /autenticacao_invalida/
  );
});

test("cookie de state expirado é rejeitado", async () => {
  reiniciar();
  const state = "state-antigo";
  // criarStateCookie assina o payload; aqui só o `exp` já passou.
  const cookie = criarStateCookie(req, state, "verifier").split(";")[0];
  const payload = JSON.parse(Buffer.from(cookie.split(".")[1], "base64url").toString("utf8"));
  assert.ok(payload.exp > Date.now(), "o cookie recém-criado precisa estar válido");

  const antigo = Date.now;
  Date.now = () => payload.exp + 1000;
  try {
    await assert.rejects(
      () => finishLogin(comCookie(cookie), { code: "codigo", state }),
      /autenticacao_invalida/
    );
  } finally {
    Date.now = antigo;
  }
});

test("domínio permitido é configurável por SSO_EMAIL_DOMINIO", async () => {
  reiniciar();
  process.env.SSO_EMAIL_DOMINIO = "exemplo.gov.br";
  try {
    const { cookie, state } = await iniciar();
    estado.claims = { ...estado.claims, preferred_username: "alguem@exemplo.gov.br" };
    const resultado = await finishLogin(comCookie(cookie), { code: "codigo", state });
    assert.match(resultado.cookie, /^cnj_sso=/);
  } finally {
    delete process.env.SSO_EMAIL_DOMINIO;
  }
});

test("currentUser lê o cookie de sessão e logout apaga a sessão", async () => {
  reiniciar();
  assert.deepEqual(await currentUser(comCookie("cnj_sso=token-valido")), estado.usuario);
  assert.equal(await currentUser(comCookie("cnj_sso=token-qualquer")), null);

  const cookie = await logout(comCookie("cnj_sso=token-valido"));
  assert.deepEqual(sessoesApagadas, ["token-valido"]);
  assert.match(cookie, /^cnj_sso=;/);
  assert.match(cookie, /Max-Age=0/);
});
