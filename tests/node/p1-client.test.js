import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { achar, documentoFake, todos } from "./helpers/dom.js";

function resposta(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (body === undefined) throw new Error("sem corpo");
      return body;
    },
  };
}

// Contexto só com o cliente HTTP P1 — sem DOM, para provar o contrato de rede.
function clienteP1(fetchImpl) {
  const global = { Date, fetch: fetchImpl, setTimeout, clearTimeout };
  global.window = global;
  global.globalThis = global;
  vm.runInContext(readFileSync("js/p1-api.js", "utf8"), vm.createContext(global), { filename: "js/p1-api.js" });
  return global.P1Api;
}

// Contexto completo da interface: tabelas + lógica CNJ reais, cliente P1 falso.
function interfaceP1(api, extras = {}) {
  const document = documentoFake();
  const global = {
    document,
    Date,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    P1Api: api,
    CNJApi: { iniciarSso() { global.ssoIniciado = (global.ssoIniciado || 0) + 1; } },
    ...extras,
  };
  global.window = global;
  global.globalThis = global;
  const contexto = vm.createContext(global);
  vm.runInContext(readFileSync("js/tables.js", "utf8"), contexto, { filename: "js/tables.js" });
  vm.runInContext(readFileSync("js/cnj.js", "utf8"), contexto, { filename: "js/cnj.js" });
  vm.runInContext(readFileSync("js/p1-ui.js", "utf8"), contexto, { filename: "js/p1-ui.js" });
  return { document, global, ui: global.P1Ui };
}

function assentar() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const CARTEIRA_CRIADOR = { id: "11111111-1111-4111-8111-111111111111", nome: "Recuperação SP", papel: "criador" };
const CARTEIRA_MEMBRO = { id: "22222222-2222-4222-8222-222222222222", nome: "Carteira compartilhada", papel: "membro" };

function apiFalsa(overrides = {}) {
  return {
    listarPortfolios: async () => ({ portfolios: [CARTEIRA_CRIADOR] }),
    criarPortfolio: async (nome) => ({ id: "33333333-3333-4333-8333-333333333333", nome, papel: "criador" }),
    renomearPortfolio: async () => ({}),
    removerPortfolio: async () => true,
    listarItens: async () => ({ itens: [] }),
    adicionarItem: async () => ({}),
    atualizarItem: async () => ({}),
    removerItem: async () => true,
    listarMembros: async () => ({ membros: [] }),
    adicionarMembro: async () => ({}),
    removerMembro: async () => true,
    listarProbes: async () => ({ probes: [] }),
    criarProbe: async () => ({}),
    atualizarProbe: async () => ({}),
    removerProbe: async () => true,
    consultarHistorico: async () => ({ snapshots: [], delta: null }),
    ...overrides,
  };
}

async function abrirCarteira(document, indice = 0) {
  await assentar();
  const botoes = todos(document.getElementById("portfolios-lista"), (no) => no.className === "p1-portfolio-btn");
  await botoes[indice].click();
  await assentar();
  return document.getElementById("portfolio-detalhe");
}

// --- cliente HTTP -----------------------------------------------------------

test("cliente P1 fala com carteiras, itens, membros, sondas e histórico com credenciais same-origin", async () => {
  const chamadas = [];
  const api = clienteP1(async (url, init) => {
    chamadas.push([url, init.method, init.credentials, init.body ? JSON.parse(init.body) : null]);
    return url.startsWith("/api/portfolios?") || init.method === "DELETE" ? resposta(204) : resposta(200, { ok: true });
  });

  await api.listarPortfolios();
  await api.criarPortfolio("Recuperação SP");
  await api.renomearPortfolio(CARTEIRA_CRIADOR.id, "Recuperação RJ");
  await api.removerPortfolio(CARTEIRA_CRIADOR.id);
  await api.listarItens(CARTEIRA_CRIADOR.id);
  await api.adicionarItem(CARTEIRA_CRIADOR.id, "44444444-4444-4444-8444-444444444444", 60);
  await api.atualizarItem(CARTEIRA_CRIADOR.id, "55555555-5555-4555-8555-555555555555", 120);
  await api.removerItem(CARTEIRA_CRIADOR.id, "55555555-5555-4555-8555-555555555555");
  await api.listarMembros(CARTEIRA_CRIADOR.id);
  await api.adicionarMembro(CARTEIRA_CRIADOR.id, "colega@exemplo.com");
  await api.removerMembro(CARTEIRA_CRIADOR.id, "66666666-6666-4666-8666-666666666666");
  await api.listarProbes(CARTEIRA_CRIADOR.id);
  await api.criarProbe(CARTEIRA_CRIADOR.id, "00013278820188260344", 1440);
  await api.atualizarProbe(CARTEIRA_CRIADOR.id, "77777777-7777-4777-8777-777777777777", { intervaloMinutos: 720 });
  await api.removerProbe(CARTEIRA_CRIADOR.id, "77777777-7777-4777-8777-777777777777");
  await api.consultarHistorico("00013278820188260344");

  assert.deepEqual(chamadas.map(([url, metodo]) => [url, metodo]), [
    ["/api/portfolios", "GET"],
    ["/api/portfolios", "POST"],
    ["/api/portfolios", "PATCH"],
    ["/api/portfolios?id=" + CARTEIRA_CRIADOR.id, "DELETE"],
    ["/api/portfolios/items?portfolioId=" + CARTEIRA_CRIADOR.id, "GET"],
    ["/api/portfolios/items", "POST"],
    ["/api/portfolios/items", "PATCH"],
    ["/api/portfolios/items?portfolioId=" + CARTEIRA_CRIADOR.id + "&id=55555555-5555-4555-8555-555555555555", "DELETE"],
    ["/api/portfolios/members?portfolioId=" + CARTEIRA_CRIADOR.id, "GET"],
    ["/api/portfolios/members", "POST"],
    ["/api/portfolios/members?portfolioId=" + CARTEIRA_CRIADOR.id + "&userId=66666666-6666-4666-8666-666666666666", "DELETE"],
    ["/api/health-probes?portfolioId=" + CARTEIRA_CRIADOR.id, "GET"],
    ["/api/health-probes", "POST"],
    ["/api/health-probes", "PATCH"],
    ["/api/health-probes?portfolioId=" + CARTEIRA_CRIADOR.id + "&id=77777777-7777-4777-8777-777777777777", "DELETE"],
    ["/api/process-history?numero=00013278820188260344", "GET"],
  ]);
  assert.ok(chamadas.every(([, , credenciais]) => credenciais === "same-origin"));

  const corpoItem = chamadas.find(([url, metodo]) => url === "/api/portfolios/items" && metodo === "POST")[3];
  assert.deepEqual(corpoItem, { portfolioId: CARTEIRA_CRIADOR.id, processId: "44444444-4444-4444-8444-444444444444", intervaloMinutos: 60 });

  // O alias nunca sai do cliente: o servidor o deriva do número.
  const corpoProbe = chamadas.find(([url, metodo]) => url === "/api/health-probes" && metodo === "POST")[3];
  assert.deepEqual(corpoProbe, { portfolioId: CARTEIRA_CRIADOR.id, numero: "00013278820188260344", intervaloMinutos: 1440 });
  assert.equal("alias" in corpoProbe, false);
});

test("cliente P1 traduz sessão expirada e erro de domínio em códigos próprios", async () => {
  const expirada = clienteP1(async () => resposta(401, { error: "autenticacao_necessaria", login: "sso" }));
  await assert.rejects(() => expirada.listarPortfolios(), /autenticacao_sso/);

  const semAcesso = clienteP1(async () => resposta(404, { error: "portfolio_nao_encontrado" }));
  await assert.rejects(() => semAcesso.removerItem(CARTEIRA_CRIADOR.id, CARTEIRA_MEMBRO.id), /portfolio_nao_encontrado/);

  const quebrado = clienteP1(async () => resposta(500, undefined));
  await assert.rejects(() => quebrado.listarPortfolios(), /erro_servidor/);
});

// --- glossário --------------------------------------------------------------

test("glossário TPU espelha o catálogo curado e filtra por código ou descrição", async () => {
  const { document, ui } = interfaceP1(apiFalsa());

  // Arrays criados dentro da vm têm outro protótipo: comparar por valor.
  assert.equal(ui.buscarGlossario("alvará").map((m) => m.codigo).join(","), "12548");
  assert.equal(ui.buscarGlossario("12548").map((m) => m.estagio).join(","), "expedicao_alvara");
  assert.equal(ui.buscarGlossario("penhora").length, 0);
  assert.equal(ui.buscarGlossario("").length, ui.GLOSSARIO_TPU.length);

  const busca = document.getElementById("glossario-busca");
  busca.value = "alvará";
  await busca.dispatch("input");
  const saida = document.getElementById("glossario-resultado");
  assert.match(saida.textContent, /12548/);
  assert.match(saida.textContent, /Expedição de alvará/);
  assert.match(saida.textContent, /tpu-2026-04-09-semente-1/);

  busca.value = "arresto";
  await busca.dispatch("input");
  assert.match(document.getElementById("glossario-resultado").textContent, /Nenhum movimento/);
});

// --- correções candidatas ---------------------------------------------------

test("sugestões de correção são candidatas: nada muda até o usuário escolher", async () => {
  const { global, document } = interfaceP1(apiFalsa());
  const bruto = "00013278820188260345"; // dígito verificador errado de propósito
  const entrada = document.createElement("input");
  entrada.value = bruto;

  const candidatos = global.CNJ.sugerirCorrecoes(bruto);
  assert.ok(candidatos.length > 0);
  assert.equal(bruto, "00013278820188260345");

  let escolhido = null;
  const bloco = global.P1Ui.blocoSugestoes(bruto, (numero) => { escolhido = numero; entrada.value = numero; });
  assert.ok(bloco);
  const botoes = todos(bloco, (no) => no.className === "sugestao");
  assert.equal(botoes.length > 0, true);
  assert.equal(entrada.value, bruto, "a entrada não pode ser corrigida sozinha");
  assert.equal(escolhido, null);

  await botoes[0].click();
  assert.notEqual(entrada.value, bruto);
  assert.equal(global.CNJ.validate(global.CNJ.parse(escolhido)), true);

  // Número válido não gera bloco nenhum.
  assert.equal(global.P1Ui.blocoSugestoes("00013278820188260344", () => {}), null);
});

// --- carteiras: criador x membro --------------------------------------------

test("carteira do criador mostra os controles de escrita de itens, membros e sondas", async () => {
  const { document } = interfaceP1(apiFalsa({
    listarItens: async () => ({ itens: [{ id: "aa", processId: "bb", numero: "00013278820188260344", intervaloMinutos: 60, proximaConsultaEm: "2026-09-02T10:00:00.000Z" }] }),
    listarMembros: async () => ({ membros: [{ id: "cc", email: "colega@exemplo.com" }] }),
    listarProbes: async () => ({ probes: [{ id: "dd", numero: "00013278820188260344", alias: "api_publica_tjsp", intervaloMinutos: 1440 }] }),
  }));

  const detalhe = await abrirCarteira(document);
  assert.match(detalhe.textContent, /Recuperação SP/);
  assert.match(detalhe.textContent, /colega@exemplo\.com/);
  assert.ok(achar(detalhe, (no) => no.className === "p1-form-item"));
  assert.ok(achar(detalhe, (no) => no.className === "p1-form-membro"));
  assert.ok(achar(detalhe, (no) => no.className === "p1-form-probe"));
  assert.equal(todos(detalhe, (no) => no.className === "p1-remover-item").length, 1);
  assert.equal(todos(detalhe, (no) => no.className === "p1-remover-membro").length, 1);
  assert.equal(todos(detalhe, (no) => no.className === "p1-remover-probe").length, 1);
  assert.equal(achar(detalhe, (no) => no.className === "p1-aviso"), null);
});

test("membro vê a carteira em leitura, sem nenhum controle de escrita", async () => {
  const { document } = interfaceP1(apiFalsa({
    listarPortfolios: async () => ({ portfolios: [CARTEIRA_MEMBRO] }),
    listarItens: async () => ({ itens: [{ id: "aa", numero: "00013278820188260344", intervaloMinutos: 60 }] }),
    listarMembros: async () => ({ membros: [{ id: "cc", email: "colega@exemplo.com" }] }),
    listarProbes: async () => ({ probes: [{ id: "dd", numero: "00013278820188260344", alias: "api_publica_tjsp", intervaloMinutos: 1440 }] }),
  }));

  const detalhe = await abrirCarteira(document);
  assert.match(detalhe.textContent, /Carteira compartilhada/);
  assert.match(detalhe.textContent, /0001327-88\.2018\.8\.26\.0344/);
  assert.match(detalhe.textContent, /somente o criador/i);
  assert.ok(achar(detalhe, (no) => no.className === "p1-aviso"));
  assert.equal(achar(detalhe, (no) => no.className === "p1-form-item"), null);
  assert.equal(achar(detalhe, (no) => no.className === "p1-form-membro"), null);
  assert.equal(achar(detalhe, (no) => no.className === "p1-form-probe"), null);
  assert.equal(todos(detalhe, (no) => /^p1-remover-/.test(no.className)).length, 0);
});

test("404 em mutação vira mensagem de acesso, não erro genérico", async () => {
  const { document, ui } = interfaceP1(apiFalsa({
    listarItens: async () => ({ itens: [{ id: "aa", numero: "00013278820188260344", intervaloMinutos: 60 }] }),
    removerItem: async () => { throw new Error("portfolio_nao_encontrado"); },
  }));

  const detalhe = await abrirCarteira(document);
  await achar(detalhe, (no) => no.className === "p1-remover-item").click();
  await assentar();

  const status = document.getElementById("portfolios-status").textContent;
  assert.match(status, /acesso/i);
  assert.match(ui.mensagemErro("portfolio_nao_encontrado"), /acesso/i);
  // Códigos herdados continuam vindo da tabela de js/app.js, sem duplicação.
  assert.equal(ui.mensagemP1("origem_nao_permitida"), null);
});

test("ação do usuário com sessão expirada vai para o login SSO", async () => {
  const { document, global } = interfaceP1(apiFalsa({
    criarPortfolio: async () => { throw new Error("autenticacao_sso"); },
  }));
  await assentar();
  document.getElementById("portfolio-nome").value = "Nova carteira";
  await document.getElementById("portfolio-form").dispatch("submit");
  await assentar();
  assert.equal(global.ssoIniciado, 1);
});

test("abrir a página com sessão ausente não redireciona sozinho", async () => {
  const { document, global } = interfaceP1(apiFalsa({
    listarPortfolios: async () => { throw new Error("autenticacao_sso"); },
  }));
  await assentar();
  assert.equal(global.ssoIniciado, undefined);
  assert.match(document.getElementById("portfolios-status").textContent, /Entrar/i);
  assert.ok(achar(document.getElementById("portfolios-status"), (no) => no.className === "p1-entrar"));
});

// --- saúde do tribunal ------------------------------------------------------

test("sonda mostra o tribunal degradado observado nas consultas da sessão", async () => {
  const { document, ui } = interfaceP1(apiFalsa({
    listarProbes: async () => ({ probes: [{ id: "dd", numero: "00013278820188260344", alias: "api_publica_tjsp", intervaloMinutos: 1440 }] }),
  }));

  assert.equal(ui.classificarTribunal("cota_excedida").estado, "degradado");
  assert.equal(ui.classificarTribunal("tribunal_indisponivel").estado, "indisponivel");
  assert.equal(ui.classificarTribunal("circuito_aberto").estado, "circuito");
  assert.equal(ui.classificarTribunal(null).estado, "disponivel");
  // Erro que não fala do tribunal não pode sujar o sinal.
  ui.registrarEstadoTribunal("api_publica_tjsp", "numero_invalido");
  assert.equal(ui.estadoTribunal("api_publica_tjsp"), null);

  ui.registrarEstadoTribunal("api_publica_tjsp", "cota_excedida");
  const detalhe = await abrirCarteira(document);
  const sinal = achar(detalhe, (no) => no.className === "p1-sinal-tribunal");
  assert.ok(sinal);
  assert.match(sinal.textContent, /Degradado/);
});

// --- histórico e diff -------------------------------------------------------

test("histórico lista os snapshots e destaca a transição de estágio", async () => {
  const { document } = interfaceP1(apiFalsa({
    consultarHistorico: async () => ({
      snapshots: [
        { id: "s2", consultadoEm: "2026-08-27T12:00:00.000Z", estagio: "expedicao_alvara", codigo: 12548, data: "2026-08-26T00:00:00.000Z", versao: "tpu-2026-04-09-semente-1" },
        { id: "s1", consultadoEm: "2026-08-20T12:00:00.000Z", estagio: "nao_classificado", codigo: null, data: null, versao: "tpu-2026-04-09-semente-1" },
      ],
      delta: { anterior: "nao_classificado", atual: "expedicao_alvara", relevante: true },
    }),
  }));
  await assentar();

  document.getElementById("historico-numero").value = "0001327-88.2018.8.26.0344";
  await document.getElementById("historico-form").dispatch("submit");
  await assentar();

  const saida = document.getElementById("historico-resultado");
  const delta = achar(saida, (no) => no.className === "p1-delta");
  assert.ok(delta);
  assert.match(delta.textContent, /Não classificado/);
  assert.match(delta.textContent, /Expedição de alvará/);
  assert.match(delta.textContent, /relevante/i);
  assert.equal(todos(saida, (no) => no.tagName === "TR").length, 3); // cabeçalho + 2 snapshots
  assert.match(saida.textContent, /12548/);
  assert.match(saida.textContent, /tpu-2026-04-09-semente-1/);
});

test("histórico de processo fora das carteiras explica o acesso", async () => {
  const { document } = interfaceP1(apiFalsa({
    consultarHistorico: async () => { throw new Error("processo_nao_encontrado"); },
  }));
  await assentar();
  document.getElementById("historico-numero").value = "0001327-88.2018.8.26.0344";
  await document.getElementById("historico-form").dispatch("submit");
  await assentar();
  assert.match(document.getElementById("historico-status").textContent, /carteira/i);
});

// --- valores remotos entram como texto --------------------------------------

test("nome de carteira e e-mail hostis chegam ao DOM como texto puro", async () => {
  const hostil = '<img src=x onerror="globalThis.pwned=1">';
  const { document, global } = interfaceP1(apiFalsa({
    listarPortfolios: async () => ({ portfolios: [{ id: CARTEIRA_CRIADOR.id, nome: hostil, papel: "criador" }] }),
    listarMembros: async () => ({ membros: [{ id: "cc", email: hostil }] }),
  }));

  const detalhe = await abrirCarteira(document);
  assert.match(detalhe.textContent, /<img src=x/);
  assert.equal(achar(detalhe, (no) => no.tagName === "IMG"), null);
  assert.equal(global.pwned, undefined);
});

// --- correções da revisão, round 1 ------------------------------------------

test("sinal de tribunal atualiza a célula sem apagar o que o criador digita", async () => {
  const { document, ui } = interfaceP1(apiFalsa({
    listarProbes: async () => ({ probes: [{ id: "dd", numero: "00013278820188260344", alias: "api_publica_tjsp", intervaloMinutos: 1440 }] }),
  }));

  const detalhe = await abrirCarteira(document);
  const formProbe = achar(detalhe, (no) => no.className === "p1-form-probe");
  const rascunho = todos(formProbe, (no) => no.tagName === "INPUT")[0];
  rascunho.value = "0001327-88.2018.8.26";

  ui.registrarEstadoTribunal("api_publica_tjsp", "cota_excedida");

  assert.equal(rascunho.value, "0001327-88.2018.8.26", "o rascunho do criador não pode ser descartado");
  const sinal = achar(document.getElementById("portfolio-detalhe"), (no) => no.className === "p1-sinal-tribunal");
  assert.match(sinal.textContent, /Degradado/);
  // O nó do formulário continua sendo o mesmo: não houve re-render do painel.
  assert.equal(achar(document.getElementById("portfolio-detalhe"), (no) => no.className === "p1-form-probe"), formProbe);
});

test("falha ao abrir outra carteira não deixa a anterior na tela", async () => {
  const outra = { id: "99999999-9999-4999-8999-999999999999", nome: "Carteira instável", papel: "criador" };
  let alvo = null;
  const { document } = interfaceP1(apiFalsa({
    listarPortfolios: async () => ({ portfolios: [CARTEIRA_CRIADOR, outra] }),
    listarItens: async (id) => {
      alvo = id;
      if (id === outra.id) throw new Error("portfolio_indisponivel");
      return { itens: [{ id: "aa", numero: "00013278820188260344", intervaloMinutos: 60 }] };
    },
  }));

  const detalhe = await abrirCarteira(document, 0);
  assert.match(detalhe.textContent, /Recuperação SP/);

  const botoes = todos(document.getElementById("portfolios-lista"), (no) => no.className === "p1-portfolio-btn");
  await botoes[1].click();
  await assentar();

  assert.equal(alvo, outra.id);
  assert.equal(document.getElementById("portfolio-detalhe").textContent, "",
    "nenhuma carteira pode continuar desenhada depois de uma troca que falhou");
  assert.match(document.getElementById("portfolios-status").textContent, /indispon/i);
});

test("consulta bem-sucedida vira ação de monitorar na carteira aberta", async () => {
  const incluidos = [];
  const { document, ui } = interfaceP1(apiFalsa({
    adicionarItem: async (portfolioId, processId, intervaloMinutos) => {
      incluidos.push([portfolioId, processId, intervaloMinutos]);
      return { id: "novo" };
    },
  }));

  // Sem carteira aberta o bloco explica o que falta, em vez de sumir calado.
  const semCarteira = ui.blocoMonitorar("44444444-4444-4444-8444-444444444444");
  assert.ok(semCarteira);
  assert.equal(achar(semCarteira, (no) => no.className === "p1-monitorar"), null);
  assert.match(semCarteira.textContent, /carteira/i);

  // Sem processId (modo sem SSO) não há o que monitorar.
  assert.equal(ui.blocoMonitorar(null), null);

  await abrirCarteira(document);
  const bloco = ui.blocoMonitorar("44444444-4444-4444-8444-444444444444");
  const acao = achar(bloco, (no) => no.className === "p1-monitorar");
  assert.ok(acao);
  assert.match(acao.textContent, /Recuperação SP/);

  await acao.click();
  await assentar();
  assert.deepEqual(incluidos, [[CARTEIRA_CRIADOR.id, "44444444-4444-4444-8444-444444444444", 1440]]);
  assert.match(bloco.textContent, /monitoramento/i);
});

test("membro não recebe ação de monitorar: só o criador inclui processos", async () => {
  const { document, ui } = interfaceP1(apiFalsa({
    listarPortfolios: async () => ({ portfolios: [CARTEIRA_MEMBRO] }),
  }));
  await abrirCarteira(document);
  const bloco = ui.blocoMonitorar("44444444-4444-4444-8444-444444444444");
  assert.equal(achar(bloco, (no) => no.className === "p1-monitorar"), null);
  assert.match(bloco.textContent, /criador/i);
});
