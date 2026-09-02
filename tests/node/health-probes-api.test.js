import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { response } from "./helpers/http.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PORTFOLIO_ID = "11111111-1111-4111-8111-111111111111";
const PROBE_ID = "77777777-7777-4777-8777-777777777777";
const PROBE_NOVO_ID = "88888888-8888-4888-8888-888888888888";
const NUMERO_TJSP = "00013278820188260344";
const NUMERO_TJMG = "00013275120188130344";

const estado = {
  usuario: { id: USER_ID, email: "criador@btblue.com.br" },
  ssoLigado: true,
  portfolio: { id: PORTFOLIO_ID, nome: "Alfa", papel: "criador" },
  probes: [{ id: PROBE_ID, numero: NUMERO_TJSP, alias: "api_publica_tjsp", intervalo_minutos: 60, proxima_consulta_em: "2026-09-01T12:00:00.000Z" }],
  criado: { id: PROBE_NOVO_ID, numero: NUMERO_TJMG, alias: "api_publica_tjmg", intervalo_minutos: 30, proxima_consulta_em: "2026-09-01T10:30:00.000Z" },
  removido: true,
};
const chamadas = [];

mock.module("../../server/sso.js", { namedExports: { currentUser: async () => estado.usuario } });
mock.module("../../server/sso-config.js", { namedExports: { ssoConfigurado: () => estado.ssoLigado } });
mock.module("../../server/db.js", {
  namedExports: {
    portfolioForUser: async (...args) => { chamadas.push(["portfolioForUser", ...args]); return estado.portfolio; },
    healthProbesForUser: async (...args) => { chamadas.push(["healthProbesForUser", ...args]); return estado.probes; },
    createHealthProbe: async (...args) => { chamadas.push(["createHealthProbe", ...args]); return estado.criado; },
    updateHealthProbeForCreator: async (...args) => { chamadas.push(["updateHealthProbeForCreator", ...args]); return estado.criado; },
    deleteHealthProbeForCreator: async (...args) => { chamadas.push(["deleteHealthProbeForCreator", ...args]); return estado.removido; },
  },
});

const headers = { host: "app.vercel.app", origin: "https://app.vercel.app" };

async function handler() {
  const modulo = await import("../../api/health-probes.js").catch(() => ({}));
  assert.equal(typeof modulo.default, "function", "api/health-probes.js precisa expor um handler");
  return modulo.default;
}

function reiniciar() {
  estado.usuario = { id: USER_ID, email: "criador@btblue.com.br" };
  estado.ssoLigado = true;
  estado.portfolio = { id: PORTFOLIO_ID, nome: "Alfa", papel: "criador" };
  estado.removido = true;
  chamadas.length = 0;
}

test("criador cria, atualiza e exclui probes de saúde do próprio portfólio", async () => {
  reiniciar();
  const probes = await handler();

  const criar = response();
  await probes({ method: "POST", headers, body: { portfolioId: PORTFOLIO_ID, numero: NUMERO_TJMG, intervaloMinutos: 30 } }, criar);
  assert.equal(criar.statusCode, 201);
  assert.deepEqual(criar.body, { id: PROBE_NOVO_ID, numero: NUMERO_TJMG, alias: "api_publica_tjmg", intervaloMinutos: 30, proximaConsultaEm: "2026-09-01T10:30:00.000Z" });

  const atualizar = response();
  await probes({ method: "PATCH", headers, body: { portfolioId: PORTFOLIO_ID, id: PROBE_NOVO_ID, intervaloMinutos: 45 } }, atualizar);
  assert.equal(atualizar.statusCode, 200);
  assert.deepEqual(atualizar.body, { id: PROBE_NOVO_ID, numero: NUMERO_TJMG, alias: "api_publica_tjmg", intervaloMinutos: 30, proximaConsultaEm: "2026-09-01T10:30:00.000Z" });

  const excluir = response();
  await probes({ method: "DELETE", headers, query: { portfolioId: PORTFOLIO_ID, id: PROBE_NOVO_ID } }, excluir);
  assert.equal(excluir.statusCode, 204);
  assert.deepEqual(chamadas.filter(([nome]) => nome !== "portfolioForUser"), [
    ["createHealthProbe", PORTFOLIO_ID, USER_ID, { numero: NUMERO_TJMG, alias: "api_publica_tjmg", intervaloMinutos: 30 }],
    ["updateHealthProbeForCreator", PORTFOLIO_ID, PROBE_NOVO_ID, USER_ID, { intervaloMinutos: 45 }],
    ["deleteHealthProbeForCreator", PORTFOLIO_ID, PROBE_NOVO_ID, USER_ID],
  ]);
});

test("membro lê probes mas mutação recebe o mesmo 404 de portfólio oculto", async () => {
  reiniciar();
  estado.portfolio = { id: PORTFOLIO_ID, nome: "Alfa", papel: "membro" };
  const probes = await handler();

  const listar = response();
  await probes({ method: "GET", headers, query: { portfolioId: PORTFOLIO_ID } }, listar);
  assert.equal(listar.statusCode, 200);
  assert.deepEqual(listar.body, { probes: [{ id: PROBE_ID, numero: NUMERO_TJSP, alias: "api_publica_tjsp", intervaloMinutos: 60, proximaConsultaEm: "2026-09-01T12:00:00.000Z" }] });

  const mutar = response();
  await probes({ method: "POST", headers, body: { portfolioId: PORTFOLIO_ID, numero: NUMERO_TJMG, intervaloMinutos: 30 } }, mutar);
  assert.equal(mutar.statusCode, 404);
  assert.deepEqual(mutar.body, { error: "portfolio_nao_encontrado" });
});

test("probe inválido falha antes do banco e origem cruzada continua bloqueada", async () => {
  reiniciar();
  const probes = await handler();

  const invalido = response();
  await probes({ method: "POST", headers, body: { portfolioId: PORTFOLIO_ID, numero: NUMERO_TJMG, intervaloMinutos: 0 } }, invalido);
  assert.equal(invalido.statusCode, 400);
  assert.deepEqual(invalido.body, { error: "probe_invalido" });
  assert.deepEqual(chamadas, []);

  const cruzada = response();
  await probes({ method: "GET", headers: { host: "app.vercel.app", origin: "https://outro.example" }, query: { portfolioId: PORTFOLIO_ID } }, cruzada);
  assert.equal(cruzada.statusCode, 403);
  assert.deepEqual(cruzada.body, { error: "origem_nao_permitida" });
});

test("probe rejeita UUID malformado e intervalo que não seja número JSON inteiro até 1440", async () => {
  reiniciar();
  const probes = await handler();

  const portfolioInvalido = response();
  await probes({ method: "GET", headers, query: { portfolioId: "portfolio-invalido" } }, portfolioInvalido);
  assert.equal(portfolioInvalido.statusCode, 400);

  const probeInvalido = response();
  await probes({ method: "PATCH", headers, body: { portfolioId: PORTFOLIO_ID, id: "probe-invalido", intervaloMinutos: 30 } }, probeInvalido);
  assert.equal(probeInvalido.statusCode, 400);

  for (const intervaloMinutos of ["30", 30.5, Number.POSITIVE_INFINITY, 1441]) {
    const res = response();
    await probes({ method: "POST", headers, body: { portfolioId: PORTFOLIO_ID, numero: NUMERO_TJMG, intervaloMinutos } }, res);
    assert.equal(res.statusCode, 400, "intervalo inválido: " + String(intervaloMinutos));
  }

  assert.deepEqual(chamadas, []);
});

// O probe mede "alias + número configurado pelo criador". O alias nunca vem do
// cliente: é derivado do número no servidor, como na consulta manual.
test("probe deriva o alias do número no servidor e recusa alias enviado pelo cliente", async () => {
  reiniciar();
  const probes = await handler();

  const comAlias = response();
  await probes({ method: "POST", headers, body: { portfolioId: PORTFOLIO_ID, alias: "api_publica_tjmg", intervaloMinutos: 30 } }, comAlias);
  assert.equal(comAlias.statusCode, 400, "sem número não há probe, mesmo com alias no corpo");
  assert.deepEqual(comAlias.body, { error: "probe_invalido" });

  const numeroInvalido = response();
  await probes({ method: "POST", headers, body: { portfolioId: PORTFOLIO_ID, numero: "00013278820188260345", intervaloMinutos: 30 } }, numeroInvalido);
  assert.equal(numeroInvalido.statusCode, 400, "dígito verificador inválido não vira probe");

  const forjado = response();
  await probes({ method: "POST", headers, body: { portfolioId: PORTFOLIO_ID, numero: NUMERO_TJMG, alias: "api_publica_tjsp", intervaloMinutos: 30 } }, forjado);
  assert.equal(forjado.statusCode, 201);
  assert.deepEqual(chamadas.filter(([nome]) => nome === "createHealthProbe"), [
    ["createHealthProbe", PORTFOLIO_ID, USER_ID, { numero: NUMERO_TJMG, alias: "api_publica_tjmg", intervaloMinutos: 30 }],
  ], "o alias gravado é sempre o derivado do número");
});

test("PATCH troca o número medido e recalcula o alias, ou mantém o que já existe", async () => {
  reiniciar();
  const probes = await handler();

  const comNumero = response();
  await probes({ method: "PATCH", headers, body: { portfolioId: PORTFOLIO_ID, id: PROBE_ID, numero: NUMERO_TJSP, intervaloMinutos: 45 } }, comNumero);
  assert.equal(comNumero.statusCode, 200);

  const semNumero = response();
  await probes({ method: "PATCH", headers, body: { portfolioId: PORTFOLIO_ID, id: PROBE_ID, intervaloMinutos: 45 } }, semNumero);
  assert.equal(semNumero.statusCode, 200);

  assert.deepEqual(chamadas.filter(([nome]) => nome === "updateHealthProbeForCreator"), [
    ["updateHealthProbeForCreator", PORTFOLIO_ID, PROBE_ID, USER_ID, { numero: NUMERO_TJSP, alias: "api_publica_tjsp", intervaloMinutos: 45 }],
    ["updateHealthProbeForCreator", PORTFOLIO_ID, PROBE_ID, USER_ID, { intervaloMinutos: 45 }],
  ]);
});
