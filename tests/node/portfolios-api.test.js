import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { response } from "./helpers/http.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PORTFOLIO_ID = "11111111-1111-4111-8111-111111111111";
const PORTFOLIO_NOVO_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const PROCESS_ID = "44444444-4444-4444-8444-444444444444";
const MEMBER_ID = "55555555-5555-4555-8555-555555555555";

const estado = {
  usuario: { id: USER_ID, email: "criador@btblue.com.br" },
  ssoLigado: true,
  portfolios: [{ id: PORTFOLIO_ID, nome: "Alfa", papel: "criador", created_at: "2026-09-01T08:00:00.000Z", updated_at: "2026-09-01T09:00:00.000Z", expires_at: "2027-02-28T09:00:00.000Z" }],
  portfolio: { id: PORTFOLIO_ID, nome: "Alfa", papel: "criador" },
  itens: [{ id: ITEM_ID, process_id: PROCESS_ID, numero: "00013278820188260344", alias: "api_publica_tjsp", intervalo_minutos: 60, proxima_consulta_em: "2026-09-01T12:00:00.000Z" }],
  membros: [{ id: MEMBER_ID, email: "membro@btblue.com.br", created_at: "2026-09-01T08:00:00.000Z", expires_at: "2027-02-28T09:00:00.000Z" }],
  criado: { id: PORTFOLIO_NOVO_ID, nome: "Beta", papel: "criador", created_at: "2026-09-01T10:00:00.000Z", updated_at: "2026-09-01T10:00:00.000Z", expires_at: "2027-02-28T10:00:00.000Z" },
  atualizado: { id: PORTFOLIO_ID, nome: "Alfa revisado", papel: "criador", created_at: "2026-09-01T08:00:00.000Z", updated_at: "2026-09-01T10:00:00.000Z", expires_at: "2027-02-28T10:00:00.000Z" },
  itemCriado: { id: ITEM_ID, process_id: PROCESS_ID, intervalo_minutos: 30, proxima_consulta_em: "2026-09-01T10:30:00.000Z" },
  membroCriado: { id: MEMBER_ID, email: "novo@btblue.com.br" },
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
  estado.usuario = { id: USER_ID, email: "criador@btblue.com.br" };
  estado.ssoLigado = true;
  estado.portfolio = { id: PORTFOLIO_ID, nome: "Alfa", papel: "criador" };
  estado.removido = true;
  chamadas.length = 0;
}

test("criador cria, renomeia e exclui o próprio portfólio", async () => {
  reiniciar();
  const portfolios = await handler("../../server/handlers/portfolio.js");

  const listar = response();
  await portfolios({ method: "GET", headers }, listar);
  assert.equal(listar.statusCode, 200);
  assert.deepEqual(listar.body, {
    portfolios: [{ id: PORTFOLIO_ID, nome: "Alfa", papel: "criador", createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z", expiresAt: "2027-02-28T09:00:00.000Z" }],
  });

  const criar = response();
  await portfolios({ method: "POST", headers, body: { nome: "Beta" } }, criar);
  assert.equal(criar.statusCode, 201);
  assert.deepEqual(criar.body, { id: PORTFOLIO_NOVO_ID, nome: "Beta", papel: "criador", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", expiresAt: "2027-02-28T10:00:00.000Z" });

  const renomear = response();
  await portfolios({ method: "PATCH", headers, body: { id: PORTFOLIO_ID, nome: "Alfa revisado" } }, renomear);
  assert.equal(renomear.statusCode, 200);
  assert.deepEqual(renomear.body, { id: PORTFOLIO_ID, nome: "Alfa revisado", papel: "criador", createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z", expiresAt: "2027-02-28T10:00:00.000Z" });

  const excluir = response();
  await portfolios({ method: "DELETE", headers, query: { id: PORTFOLIO_ID } }, excluir);
  assert.equal(excluir.statusCode, 204);
  assert.deepEqual(chamadas.slice(-3), [
    ["createPortfolio", USER_ID, { nome: "Beta" }],
    ["updatePortfolioForCreator", PORTFOLIO_ID, USER_ID, { nome: "Alfa revisado" }],
    ["deletePortfolioForCreator", PORTFOLIO_ID, USER_ID],
  ]);
});

test("membro ativo lê itens e membros, mas não pode mutar o portfólio", async () => {
  reiniciar();
  estado.portfolio = { id: PORTFOLIO_ID, nome: "Alfa", papel: "membro" };
  const itens = await handler("../../server/handlers/portfolio-items.js");
  const membros = await handler("../../server/handlers/portfolio-members.js");

  const lerItens = response();
  await itens({ method: "GET", headers, query: { portfolioId: PORTFOLIO_ID } }, lerItens);
  assert.equal(lerItens.statusCode, 200);
  assert.deepEqual(lerItens.body, { itens: [{ id: ITEM_ID, processId: PROCESS_ID, numero: "00013278820188260344", alias: "api_publica_tjsp", intervaloMinutos: 60, proximaConsultaEm: "2026-09-01T12:00:00.000Z" }] });

  const lerMembros = response();
  await membros({ method: "GET", headers, query: { portfolioId: PORTFOLIO_ID } }, lerMembros);
  assert.equal(lerMembros.statusCode, 200);
  assert.deepEqual(lerMembros.body, { membros: [{ id: MEMBER_ID, email: "membro@btblue.com.br", createdAt: "2026-09-01T08:00:00.000Z", expiresAt: "2027-02-28T09:00:00.000Z" }] });

  const criarItem = response();
  await itens({ method: "POST", headers, body: { portfolioId: PORTFOLIO_ID, processId: PROCESS_ID, intervaloMinutos: 30 } }, criarItem);
  assert.equal(criarItem.statusCode, 404);
  assert.deepEqual(criarItem.body, { error: "portfolio_nao_encontrado" });

  const criarMembro = response();
  await membros({ method: "POST", headers, body: { portfolioId: PORTFOLIO_ID, email: "novo@btblue.com.br" } }, criarMembro);
  assert.equal(criarMembro.statusCode, 404);
  assert.deepEqual(criarMembro.body, { error: "portfolio_nao_encontrado" });
});

test("outro portfólio é 404 tanto na leitura quanto na mutação", async () => {
  reiniciar();
  estado.portfolio = null;
  const itens = await handler("../../server/handlers/portfolio-items.js");

  const leitura = response();
  await itens({ method: "GET", headers, query: { portfolioId: PORTFOLIO_NOVO_ID } }, leitura);
  assert.equal(leitura.statusCode, 404);
  assert.deepEqual(leitura.body, { error: "portfolio_nao_encontrado" });

  const mutacao = response();
  await itens({ method: "PATCH", headers, body: { portfolioId: PORTFOLIO_NOVO_ID, id: ITEM_ID, intervaloMinutos: 15 } }, mutacao);
  assert.equal(mutacao.statusCode, 404);
  assert.deepEqual(mutacao.body, leitura.body, "não pode revelar se o portfólio alheio existe");
});

test("item monitorado devolve a linha Neon em camelCase", async () => {
  reiniciar();
  const itens = await handler("../../server/handlers/portfolio-items.js");
  const res = response();

  await itens({ method: "POST", headers, body: { portfolioId: PORTFOLIO_ID, processId: PROCESS_ID, intervaloMinutos: 30 } }, res);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { id: ITEM_ID, processId: PROCESS_ID, intervaloMinutos: 30, proximaConsultaEm: "2026-09-01T10:30:00.000Z" });
});

test("UUIDs malformados de portfólio, item, membro e processo são recusados antes do banco", async () => {
  reiniciar();
  const portfolios = await handler("../../server/handlers/portfolio.js");
  const itens = await handler("../../server/handlers/portfolio-items.js");
  const membros = await handler("../../server/handlers/portfolio-members.js");

  const portfolioInvalido = response();
  await portfolios({ method: "PATCH", headers, body: { id: "portfolio-invalido", nome: "Alfa" } }, portfolioInvalido);
  assert.equal(portfolioInvalido.statusCode, 400);

  const itemPortfolioInvalido = response();
  await itens({ method: "GET", headers, query: { portfolioId: "portfolio-invalido" } }, itemPortfolioInvalido);
  assert.equal(itemPortfolioInvalido.statusCode, 400);

  const processoInvalido = response();
  await itens({ method: "POST", headers, body: { portfolioId: PORTFOLIO_ID, processId: "processo-invalido", intervaloMinutos: 30 } }, processoInvalido);
  assert.equal(processoInvalido.statusCode, 400);

  const itemInvalido = response();
  await itens({ method: "PATCH", headers, body: { portfolioId: PORTFOLIO_ID, id: "item-invalido", intervaloMinutos: 30 } }, itemInvalido);
  assert.equal(itemInvalido.statusCode, 400);

  const membroInvalido = response();
  await membros({ method: "DELETE", headers, query: { portfolioId: PORTFOLIO_ID, userId: "membro-invalido" } }, membroInvalido);
  assert.equal(membroInvalido.statusCode, 400);
  assert.deepEqual(chamadas, []);
});

test("intervalo de monitoramento aceita somente número JSON inteiro entre 1 e 1440 minutos", async () => {
  reiniciar();
  const itens = await handler("../../server/handlers/portfolio-items.js");
  const base = { portfolioId: PORTFOLIO_ID, processId: PROCESS_ID };

  for (const intervaloMinutos of ["30", 30.5, Number.POSITIVE_INFINITY, 1441]) {
    const res = response();
    await itens({ method: "POST", headers, body: { ...base, intervaloMinutos } }, res);
    assert.equal(res.statusCode, 400, "intervalo inválido: " + String(intervaloMinutos));
    assert.deepEqual(res.body, { error: "item_invalido" });
  }

  const teto = response();
  await itens({ method: "POST", headers, body: { ...base, intervaloMinutos: 1440 } }, teto);
  assert.equal(teto.statusCode, 201);
});

test("rotas de portfólio preservam origem e sessão SSO do P0", async () => {
  reiniciar();
  const portfolios = await handler("../../server/handlers/portfolio.js");

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
