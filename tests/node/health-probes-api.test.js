import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { response } from "./helpers/http.js";

const estado = {
  usuario: { id: "user-1", email: "criador@btblue.com.br" },
  ssoLigado: true,
  portfolio: { id: "portfolio-1", nome: "Alfa", papel: "criador" },
  probes: [{ id: "probe-1", alias: "api_publica_tjsp", intervaloMinutos: 60, proximaConsultaEm: "2026-09-01T12:00:00.000Z" }],
  criado: { id: "probe-2", alias: "api_publica_tjmg", intervaloMinutos: 30 },
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
  estado.usuario = { id: "user-1", email: "criador@btblue.com.br" };
  estado.ssoLigado = true;
  estado.portfolio = { id: "portfolio-1", nome: "Alfa", papel: "criador" };
  estado.removido = true;
  chamadas.length = 0;
}

test("criador cria, atualiza e exclui probes de saúde do próprio portfólio", async () => {
  reiniciar();
  const probes = await handler();

  const criar = response();
  await probes({ method: "POST", headers, body: { portfolioId: "portfolio-1", alias: "api_publica_tjmg", intervaloMinutos: 30 } }, criar);
  assert.equal(criar.statusCode, 201);
  assert.deepEqual(criar.body, estado.criado);

  const atualizar = response();
  await probes({ method: "PATCH", headers, body: { portfolioId: "portfolio-1", id: "probe-2", intervaloMinutos: 45 } }, atualizar);
  assert.equal(atualizar.statusCode, 200);
  assert.deepEqual(atualizar.body, estado.criado);

  const excluir = response();
  await probes({ method: "DELETE", headers, query: { portfolioId: "portfolio-1", id: "probe-2" } }, excluir);
  assert.equal(excluir.statusCode, 204);
  assert.deepEqual(chamadas.filter(([nome]) => nome !== "portfolioForUser"), [
    ["createHealthProbe", "portfolio-1", "user-1", { alias: "api_publica_tjmg", intervaloMinutos: 30 }],
    ["updateHealthProbeForCreator", "portfolio-1", "probe-2", "user-1", { intervaloMinutos: 45 }],
    ["deleteHealthProbeForCreator", "portfolio-1", "probe-2", "user-1"],
  ]);
});

test("membro lê probes mas mutação recebe o mesmo 404 de portfólio oculto", async () => {
  reiniciar();
  estado.portfolio = { id: "portfolio-1", nome: "Alfa", papel: "membro" };
  const probes = await handler();

  const listar = response();
  await probes({ method: "GET", headers, query: { portfolioId: "portfolio-1" } }, listar);
  assert.equal(listar.statusCode, 200);
  assert.deepEqual(listar.body, { probes: estado.probes });

  const mutar = response();
  await probes({ method: "POST", headers, body: { portfolioId: "portfolio-1", alias: "api_publica_tjmg", intervaloMinutos: 30 } }, mutar);
  assert.equal(mutar.statusCode, 404);
  assert.deepEqual(mutar.body, { error: "portfolio_nao_encontrado" });
});

test("probe inválido falha antes do banco e origem cruzada continua bloqueada", async () => {
  reiniciar();
  const probes = await handler();

  const invalido = response();
  await probes({ method: "POST", headers, body: { portfolioId: "portfolio-1", alias: "tjsp", intervaloMinutos: 0 } }, invalido);
  assert.equal(invalido.statusCode, 400);
  assert.deepEqual(invalido.body, { error: "probe_invalido" });
  assert.deepEqual(chamadas, []);

  const cruzada = response();
  await probes({ method: "GET", headers: { host: "app.vercel.app", origin: "https://outro.example" }, query: { portfolioId: "portfolio-1" } }, cruzada);
  assert.equal(cruzada.statusCode, 403);
  assert.deepEqual(cruzada.body, { error: "origem_nao_permitida" });
});
