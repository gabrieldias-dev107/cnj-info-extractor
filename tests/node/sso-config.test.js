import assert from "node:assert/strict";
import test from "node:test";

test("configuração SSO aceita os nomes M365 usados na Vercel", async () => {
  const anterior = {
    M365_TENANT_ID: process.env.M365_TENANT_ID,
    M365_CLIENT_ID: process.env.M365_CLIENT_ID,
    M365_CLIENT_SECRET: process.env.M365_CLIENT_SECRET,
    ENTRA_TENANT_ID: process.env.ENTRA_TENANT_ID,
    ENTRA_CLIENT_ID: process.env.ENTRA_CLIENT_ID,
    ENTRA_CLIENT_SECRET: process.env.ENTRA_CLIENT_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };

  delete process.env.ENTRA_TENANT_ID;
  delete process.env.ENTRA_CLIENT_ID;
  delete process.env.ENTRA_CLIENT_SECRET;
  process.env.M365_TENANT_ID = "tenant-m365";
  process.env.M365_CLIENT_ID = "client-m365";
  process.env.M365_CLIENT_SECRET = "secret-m365";
  process.env.DATABASE_URL = "postgresql://example";
  process.env.SESSION_SECRET = "segredo-de-sessao-com-pelo-menos-32-caracteres";

  const { configuracaoSso, ssoConfigurado } = await import("../../server/sso-config.js?m365=" + Date.now());
  assert.equal(ssoConfigurado(), true);
  assert.deepEqual(configuracaoSso(), {
    tenantId: "tenant-m365",
    clientId: "client-m365",
    clientSecret: "secret-m365",
  });

  for (const [nome, valor] of Object.entries(anterior)) {
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  }
});

test("cookie OIDC rejeita state ou verifier adulterados", async () => {
  const anterior = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "segredo-de-sessao-com-pelo-menos-32-caracteres";
  const { criarStateCookie, lerStateCookie } = await import("../../server/sso.js?cookie=" + Date.now());
  const req = { headers: {} };
  const setCookie = criarStateCookie(req, "state-correto", "verifier-correto");
  const valor = setCookie.match(/^cnj_oidc=([^;]+)/)[1];

  req.headers.cookie = "cnj_oidc=" + valor;
  const lido = lerStateCookie(req);
  assert.equal(lido.state, "state-correto");
  assert.equal(lido.verifier, "verifier-correto");
  assert.equal(typeof lido.exp, "number");

  const partes = valor.split(".");
  const adulterado = Buffer.from(JSON.stringify({ ...lido, state: "forged" })).toString("base64url");
  req.headers.cookie = "cnj_oidc=" + partes[0] + "." + adulterado + "." + partes[2];
  assert.throws(() => lerStateCookie(req), /autenticacao_invalida/);

  if (anterior === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = anterior;
});
