import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { response } from "./helpers/http.js";

const estado = {
  usuario: { id: "user-1", email: "criador@btblue.com.br" },
  ssoLigado: true,
  portfolios: [{ id: "portfolio-1", nome: "Alfa", papel: "criador" }],
  portfolio: { id: "portfolio-1", nome: "Alfa", papel: "criador" },
  itens: [{ id: "item-1", numero: "00013278820188260344", intervaloMinutos: 60 }],
  membros: [{ id: "user-2", email: "membro@btblue.com.br" }],
  criado: { id: "portfolio-2", nome: "Beta", papel: "criador" },
  atualizado: { id: "portfolio-1", nome: "Alfa revisado", papel: "criador" },
  itemCriado: { id: "item-2", processId: "process-1", intervaloMinutos: 30 },
  membroCriado: { id: "user-3", email: "novo@btblue.com.br" },
  removido: true,
};
const chamadas = [];

mock.module("../../server/sso.js", { namedExports: { currentUser: async () => estado.usuario } });
mock.module("../../server/sso-config.js", { namedExports: { ssoConfigurado: () => estado.ssoLigado } });
mock.module("../../server/db.js", {
  namedExports: {
    createPortfolio: async (...args) => { chamadas.push(["createPortfolio", ...args]); return estado.criado; },
    portfoliosForUser: async (...args) => { chamadas.push(["portfoliosForUser", ...args]); return estado.portfolios; },
    portfolioForUser: async (...args) => { chamadas.push(["portfolioForUser", ...args]); return estado.portfolio; },
    updatePortfolioForCreator: async (...args) => { chamadas.push(["updatePortfolioForCreator", ...args]); return estado.atualizado; },
    deletePortfolioForCreator: async (...args) => { chamadas.push(["deletePortfolioForCreator", ...args]); return estado.removido; },
    portfolioItemsForUser: async (...args) => { chamadas.push(["portfolioItemsForUser", ...args]); return estado.itens; },
    createPortfolioItem: async (...args) => { chamadas.push(["createPortfolioItem", ...args]); return estado.itemCriado; },
    updatePortfolioItemForCreator: async (...args) => { chamadas.push(["updatePortfolioItemForCreator", ...args]); return estado.itemCriado; },
    deletePortfolioItemForCreator: async (...args) => { chamadas.push(["deletePortfolioItemForCreator", ...args]); return estado.removido; },
    portfolioMembersForUser: async (...args) => { chamadas.push(["portfolioMembersForUser", ...args]); return estado.membros; },
    addPortfolioMemberForCreator: async (...args) => { chamadas.push(["addPortfolioMemberForCreator", ...args]); return estado.membroCriado; },
    deletePortfolioMemberForCreator: async (...args) => { chamadas.push(["deletePortfolioMemberForCreator", ...args]); return estado.removido; },
  },
});

const headers = { host: "app.vercel.app", origin: "https://app.vercel.app" };

async function handler(caminho) {
  const modulo = await import(caminho).catch(() => ({}));
  assert.equal(typeof modulo.default, "function", caminho + " precisa expor um handler");
  return modulo.default;
}

function reiniciar() {
  estado.usuario = { id: "user-1", email: "criador@btblue.com.br" };
  estado.ssoLigado = true;
  estado.portfolio = { id: "portfolio-1", nome: "Alfa", papel: "criador" };
  estado.removido = true;
  chamadas.length = 0;
}

test("criador cria, renomeia e exclui o próprio portfólio", async () => {
  reiniciar();
  const portfolios = await handler("../../api/portfolios/index.js");

  const criar = response();
  await portfolios({ method: "POST", headers, body: { nome: "Beta" } }, criar);
  assert.equal(criar.statusCode, 201);
  assert.deepEqual(criar.body, estado.criado);

  const renomear = response();
  await portfolios({ method: "PATCH", headers, body: { id: "portfolio-1", nome: "Alfa revisado" } }, renomear);
  assert.equal(renomear.statusCode, 200);
  assert.deepEqual(renomear.body, estado.atualizado);

  const excluir = response();
  await portfolios({ method: "DELETE", headers, query: { id: "portfolio-1" } }, excluir);
  assert.equal(excluir.statusCode, 204);
  assert.deepEqual(chamadas.slice(-3), [
    ["createPortfolio", "user-1", { nome: "Beta" }],
    ["updatePortfolioForCreator", "portfolio-1", "user-1", { nome: "Alfa revisado" }],
    ["deletePortfolioForCreator", "portfolio-1", "user-1"],
  ]);
});

test("membro ativo lê itens e membros, mas não pode mutar o portfólio", async () => {
  reiniciar();
  estado.portfolio = { id: "portfolio-1", nome: "Alfa", papel: "membro" };
  const itens = await handler("../../api/portfolios/items.js");
  const membros = await handler("../../api/portfolios/members.js");

  const lerItens = response();
  await itens({ method: "GET", headers, query: { portfolioId: "portfolio-1" } }, lerItens);
  assert.equal(lerItens.statusCode, 200);
  assert.deepEqual(lerItens.body, { itens: estado.itens });

  const lerMembros = response();
  await membros({ method: "GET", headers, query: { portfolioId: "portfolio-1" } }, lerMembros);
  assert.equal(lerMembros.statusCode, 200);
  assert.deepEqual(lerMembros.body, { membros: estado.membros });

  const criarItem = response();
  await itens({ method: "POST", headers, body: { portfolioId: "portfolio-1", processId: "process-1", intervaloMinutos: 30 } }, criarItem);
  assert.equal(criarItem.statusCode, 404);
  assert.deepEqual(criarItem.body, { error: "portfolio_nao_encontrado" });

  const criarMembro = response();
  await membros({ method: "POST", headers, body: { portfolioId: "portfolio-1", email: "novo@btblue.com.br" } }, criarMembro);
  assert.equal(criarMembro.statusCode, 404);
  assert.deepEqual(criarMembro.body, { error: "portfolio_nao_encontrado" });
});

test("outro portfólio é 404 tanto na leitura quanto na mutação", async () => {
  reiniciar();
  estado.portfolio = null;
  const itens = await handler("../../api/portfolios/items.js");

  const leitura = response();
  await itens({ method: "GET", headers, query: { portfolioId: "portfolio-alheio" } }, leitura);
  assert.equal(leitura.statusCode, 404);
  assert.deepEqual(leitura.body, { error: "portfolio_nao_encontrado" });

  const mutacao = response();
  await itens({ method: "PATCH", headers, body: { portfolioId: "portfolio-alheio", id: "item-1", intervaloMinutos: 15 } }, mutacao);
  assert.equal(mutacao.statusCode, 404);
  assert.deepEqual(mutacao.body, leitura.body, "não pode revelar se o portfólio alheio existe");
});

test("rotas de portfólio preservam origem e sessão SSO do P0", async () => {
  reiniciar();
  const portfolios = await handler("../../api/portfolios/index.js");

  const cruzada = response();
  await portfolios({ method: "GET", headers: { host: "app.vercel.app", origin: "https://outro.example" } }, cruzada);
  assert.equal(cruzada.statusCode, 403);
  assert.deepEqual(cruzada.body, { error: "origem_nao_permitida" });

  estado.usuario = null;
  const semSessao = response();
  await portfolios({ method: "GET", headers }, semSessao);
  assert.equal(semSessao.statusCode, 401);
  assert.deepEqual(semSessao.body, { error: "autenticacao_necessaria", login: "sso" });
});
