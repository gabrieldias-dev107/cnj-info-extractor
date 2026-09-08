import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { achar, documentoFake, todos } from "./helpers/dom.js";

// Contexto mínimo de janela para rodar js/app.js sob vm.
function contexto(document, api) {
  const global = {
    document,
    CNJ: {
      normalize: (valor) => String(valor).replace(/\D/g, ""),
      format: (valor) => valor,
      describe: (digitos) => ({ digitos, valido: true, sequencial: "0001327", verificador: "88", ano: "2018", segmento: "8", segmentoNome: "Estadual", tribunal: "26", tribunalNome: "TJSP", tribunalConhecido: true, origem: "0344", formatado: digitos }),
    },
    CNJ_TABLES: { deriveAlias: () => ({ alias: "api_publica_tjsp" }) },
    CNJApi: api,
    Date,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  global.window = global;
  global.globalThis = global;
  return global;
}

test("login retenta consulta, restaura foco e renderiza payload XSS como texto", async () => {
  const document = documentoFake();
  let consultas = 0;
  const malicioso = '<img src=x onerror="globalThis.pwned=1">';
  const api = {
    verificarSessao: async () => { throw new Error("autenticacao_necessaria"); },
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => {
      consultas += 1;
      if (consultas === 1) throw new Error("autenticacao_necessaria");
      return { encontrado: true, processos: [{ classe: { nome: malicioso }, assuntos: [], movimentos: [], grau: "G1" }] };
    },
  };
  const global = {
    document,
    CNJ: {
      normalize: (valor) => String(valor).replace(/\D/g, ""),
      format: (valor) => valor,
      describe: (digitos) => ({ digitos, valido: true, sequencial: "0001327", verificador: "88", ano: "2018", segmento: "8", segmentoNome: "Estadual", tribunal: "26", tribunalNome: "TJSP", tribunalConhecido: true, origem: "0344", formatado: digitos }),
    },
    CNJ_TABLES: { deriveAlias: () => ({ alias: "api_publica_tjsp" }) },
    CNJApi: api,
    Date,
    setTimeout,
    clearTimeout,
  };
  global.window = global;
  global.globalThis = global;
  vm.runInContext(readFileSync("js/app.js", "utf8"), vm.createContext(global), { filename: "js/app.js" });

  const input = document.getElementById("cnj-input");
  input.value = "00013278820188260344";
  await input.dispatch("input");
  const consultar = achar(document.getElementById("resultado"), (node) => node.className === "btn-consultar");
  consultar.focus();
  await consultar.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("login-dialog").open, true);
  assert.equal(document.activeElement, document.getElementById("login-password"));

  document.getElementById("login-password").value = "senha";
  await document.getElementById("login-form").dispatch("submit");
  assert.equal(consultas, 2);
  assert.equal(document.activeElement, consultar);
  const online = document.getElementById("resultado-online");
  assert.match(online.textContent, /<img src=x/);
  assert.equal(achar(online, (node) => node.tagName === "IMG"), null);
  assert.equal(global.pwned, undefined);
});

test("consulta sem sessão Entra redireciona sem abrir diálogo de senha", async () => {
  const document = documentoFake();
  let iniciouSso = 0;
  const api = {
    verificarSessao: async () => { throw new Error("autenticacao_necessaria"); },
    iniciarSso() { iniciouSso += 1; },
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => { throw new Error("autenticacao_sso"); },
  };
  const global = {
    document,
    CNJ: {
      normalize: (valor) => String(valor).replace(/\D/g, ""),
      format: (valor) => valor,
      describe: (digitos) => ({ digitos, valido: true, sequencial: "0001327", verificador: "88", ano: "2018", segmento: "8", segmentoNome: "Estadual", tribunal: "26", tribunalNome: "TJSP", tribunalConhecido: true, origem: "0344", formatado: digitos }),
    },
    CNJ_TABLES: { deriveAlias: () => ({ alias: "api_publica_tjsp" }) },
    CNJApi: api,
    Date,
    setTimeout,
    clearTimeout,
  };
  global.window = global;
  global.globalThis = global;
  vm.runInContext(readFileSync("js/app.js", "utf8"), vm.createContext(global), { filename: "js/app.js" });

  const input = document.getElementById("cnj-input");
  input.value = "00013278820188260344";
  await input.dispatch("input");
  const consultar = achar(document.getElementById("resultado"), (node) => node.className === "btn-consultar");
  await consultar.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(iniciouSso, 1);
  assert.equal(document.getElementById("login-dialog").open, false);
});

test("modo Entra nao redireciona ao abrir a ferramenta", async () => {
  // O decodificador offline é público; só as ações que exigem identidade
  // levam ao Entra. Ver o teste da consulta online logo acima.
  const document = documentoFake();
  let iniciouSso = 0;
  const api = {
    verificarSessao: async () => { throw new Error("autenticacao_sso"); },
    iniciarSso() { iniciouSso += 1; },
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => ({ encontrado: false, processos: [] }),
  };
  const global = { document, CNJ: { normalize: () => "", format: () => "", describe: () => null }, CNJ_TABLES: { deriveAlias: () => ({ alias: null }) }, CNJApi: api, Date, setTimeout, clearTimeout };
  global.window = global;
  global.globalThis = global;
  vm.runInContext(readFileSync("js/app.js", "utf8"), vm.createContext(global), { filename: "js/app.js" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(iniciouSso, 0);
  assert.equal(document.getElementById("session-logout").hidden, true);
  assert.equal(document.getElementById("login-dialog").open, false);
});

test("resultado online mostra o estágio TPU classificado", async () => {
  const document = documentoFake();
  const api = {
    verificarSessao: async () => true,
    iniciarSso() {},
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => ({
      encontrado: true,
      total: 1,
      processos: [{ grau: "G1", tribunal: "TJSP", movimentos: [] }],
      estagio: { estagio: "expedicao_alvara", codigo: 12548, data: "2026-08-20T10:00:00.000Z", idadeDias: 7, versao: "tpu-2026-04-09-semente-1" },
    }),
  };
  const global = contexto(document, api);
  vm.runInContext(readFileSync("js/app.js", "utf8"), vm.createContext(global), { filename: "js/app.js" });

  const input = document.getElementById("cnj-input");
  input.value = "00013278820188260344";
  await input.dispatch("input");
  await achar(document.getElementById("resultado"), (node) => node.className === "btn-consultar").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const texto = document.getElementById("resultado-online").textContent;
  assert.match(texto, /Estágio \(TPU\)/);
  assert.match(texto, /Expedição de alvará/);
  assert.match(texto, /código 12548/);
  assert.match(texto, /há 7 dias/);
});

test("processo sem código curado aparece como não classificado", async () => {
  const document = documentoFake();
  const api = {
    verificarSessao: async () => true,
    iniciarSso() {},
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => ({
      encontrado: true,
      total: 1,
      processos: [{ grau: "G1", tribunal: "TJSP", movimentos: [] }],
      estagio: { estagio: "nao_classificado", codigo: null, data: null, idadeDias: null, versao: "tpu-2026-04-09-semente-1" },
    }),
  };
  const global = contexto(document, api);
  vm.runInContext(readFileSync("js/app.js", "utf8"), vm.createContext(global), { filename: "js/app.js" });

  const input = document.getElementById("cnj-input");
  input.value = "00013278820188260344";
  await input.dispatch("input");
  await achar(document.getElementById("resultado"), (node) => node.className === "btn-consultar").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const texto = document.getElementById("resultado-online").textContent;
  assert.match(texto, /Não classificado/);
  assert.match(texto, /Nenhum movimento com código TPU curado/);
});

test("painel do lote lista cada linha com situação e estágio", async () => {
  const document = documentoFake();
  const api = {
    verificarSessao: async () => true,
    iniciarSso() {},
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => ({ encontrado: false, processos: [] }),
    criarLote: async () => ({ id: "lote-1", total: 2 }),
    consultarLote: async () => ({
      id: "lote-1",
      status: "concluido",
      total: 2,
      contagens: { concluido: 1, invalido: 1 },
      itens: [
        { linha: 1, numero: "00013278820188260344", status: "concluido", erro: null, estagio: "expedicao_alvara", score_faixa: "prioridade_alta", score_confianca: "alta" },
        { linha: 2, numero: "123", status: "invalido", erro: "numero_invalido", estagio: null, score_faixa: null },
      ],
    }),
  };
  const global = contexto(document, api);
  vm.runInContext(readFileSync("js/app.js", "utf8"), vm.createContext(global), { filename: "js/app.js" });

  document.getElementById("batch-numbers").value = "00013278820188260344\n123";
  await document.getElementById("batch-form").dispatch("submit");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const painel = document.getElementById("batch-itens");
  assert.equal(painel.hidden, false);
  const texto = painel.textContent;
  assert.match(texto, /Estágio \(TPU\)/);
  assert.match(texto, /00013278820188260344/);
  assert.match(texto, /Concluído/);
  assert.match(texto, /Expedição de alvará/);
  assert.match(texto, /Número inválido — numero_invalido/);
  // A faixa entra como coluna própria, e a ressalva fica ao lado da tabela:
  // coluna sozinha é exatamente o que não pode ser lido como decisão.
  assert.match(texto, /Faixa \(indício\)/);
  assert.match(texto, /Prioridade alta/);
  // Confiança tem coluna própria: faixa apoiada em TPU curado não pode ficar
  // indistinguível de faixa tirada só de sinais secundários.
  assert.match(texto, /Confiança/);
  assert.match(texto, /confiança alta/);
  assert.match(texto, /pendentes de aprovação da área de risco/);
  assert.match(texto, /Não é decisão de crédito/);
  // Sem innerHTML: cada célula é um nó de texto criado pelo app.
  assert.ok(achar(painel, (node) => node.tagName === "TABLE"));
  assert.equal(document.getElementById("batch-export").hidden, false);
});

// Contexto com a lógica CNJ real e a interface P1 carregada junto: é assim que
// os dois scripts convivem no index.html.
function contextoComP1(document, api) {
  const global = {
    document,
    CNJApi: api,
    P1Api: {
      listarPortfolios: async () => ({ portfolios: [] }),
      listarItens: async () => ({ itens: [] }),
      listarMembros: async () => ({ membros: [] }),
      listarProbes: async () => ({ probes: [] }),
      consultarHistorico: async () => ({ snapshots: [], delta: null }),
    },
    Date,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  global.window = global;
  global.globalThis = global;
  const contexto = vm.createContext(global);
  for (const arquivo of ["js/tables.js", "js/cnj.js", "js/p1-ui.js", "js/app.js"]) {
    vm.runInContext(readFileSync(arquivo, "utf8"), contexto, { filename: arquivo });
  }
  return global;
}

test("número com dígito verificador errado oferece candidatos sem corrigir a entrada", async () => {
  const document = documentoFake();
  const api = {
    verificarSessao: async () => true,
    iniciarSso() {},
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => ({ encontrado: false, processos: [] }),
  };
  const global = contextoComP1(document, api);

  const input = document.getElementById("cnj-input");
  const digitado = "0001327-88.2018.8.26.0345"; // DV inválido de propósito
  input.value = digitado;
  await input.dispatch("input");

  const resultado = document.getElementById("resultado");
  const sugestoes = todos(resultado, (no) => no.className === "sugestao");
  assert.ok(sugestoes.length > 0, "esperava candidatos para o número inválido");
  assert.equal(global.CNJ.normalize(input.value), "00013278820188260345");

  await sugestoes[0].click();
  const corrigido = global.CNJ.normalize(input.value);
  assert.notEqual(corrigido, "00013278820188260345");
  assert.equal(global.CNJ.validate(global.CNJ.parse(corrigido)), true);
});

test("falha do tribunal na consulta vira sinal de saúde para as sondas", async () => {
  const document = documentoFake();
  const api = {
    verificarSessao: async () => true,
    iniciarSso() {},
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => { throw new Error("tribunal_indisponivel"); },
  };
  const global = contextoComP1(document, api);

  const input = document.getElementById("cnj-input");
  input.value = "0001327-88.2018.8.26.0344";
  await input.dispatch("input");
  await achar(document.getElementById("resultado"), (no) => no.className === "btn-consultar").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(global.P1Ui.estadoTribunal("api_publica_tjsp"), "tribunal_indisponivel");
  assert.match(document.getElementById("resultado-online").textContent, /tribunal está indisponível/i);
});

test("resultado da consulta online oferece monitorar o processo encontrado", async () => {
  const document = documentoFake();
  const incluidos = [];
  const api = {
    verificarSessao: async () => true,
    iniciarSso() {},
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => ({
      encontrado: true,
      total: 1,
      processId: "44444444-4444-4444-8444-444444444444",
      processos: [{ grau: "G1", tribunal: "TJSP", movimentos: [] }],
      estagio: { estagio: "nao_classificado", codigo: null, data: null, idadeDias: null, versao: "tpu-teste" },
    }),
  };
  const global = contextoComP1(document, api);
  global.P1Api.listarPortfolios = async () => ({ portfolios: [{ id: "11111111-1111-4111-8111-111111111111", nome: "Recuperação SP", papel: "criador" }] });
  global.P1Api.adicionarItem = async (portfolioId, processId, intervaloMinutos) => {
    incluidos.push([portfolioId, processId, intervaloMinutos]);
    return { id: "novo" };
  };
  // Recarrega a lista agora que o stub devolve uma carteira e abre a carteira.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await global.P1Ui.recarregarCarteiras();
  await todos(document.getElementById("portfolios-lista"), (no) => no.className === "p1-portfolio-btn")[0].click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const input = document.getElementById("cnj-input");
  input.value = "0001327-88.2018.8.26.0344";
  await input.dispatch("input");
  await achar(document.getElementById("resultado"), (no) => no.className === "btn-consultar").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const acao = achar(document.getElementById("resultado-online"), (no) => no.className === "p1-monitorar");
  assert.ok(acao, "esperava a ação de monitorar junto do resultado da consulta");
  await acao.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(incluidos, [["11111111-1111-4111-8111-111111111111", "44444444-4444-4444-8444-444444444444", 1440]]);
});

// O maior risco desta entrega é a faixa ser lida como certeza. Onde ela aparece,
// aparecem também confiança, fatores e ressalva.
test("consulta online mostra a faixa sempre acompanhada de confiança e ressalva", async () => {
  const document = documentoFake();
  const score = {
    faixa: "prioridade_media",
    pontos: 45,
    confianca: "baixa",
    fatores: [
      { fator: "estagio_tpu", pontos: 0, motivo: "Nenhum movimento com código TPU curado foi encontrado." },
      { fator: "grau", pontos: 15, motivo: "Grau G1." },
    ],
    versao: "score-2026-09-08-semente-1",
    aprovadaPorRisco: false,
    fonte: "indicio_publico_datajud",
    ressalva: "Estágio processual desconhecido: pesos semente pendentes de aprovação da área de risco.",
  };
  const api = {
    verificarSessao: async () => true,
    iniciarSso() {},
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => ({
      encontrado: true,
      total: 1,
      processos: [{ grau: "G1", tribunal: "TJSP", movimentos: [] }],
      estagio: { estagio: "nao_classificado", codigo: null, data: null, idadeDias: null, versao: "tpu-2026-04-09-semente-1" },
      score,
    }),
  };
  const global = contexto(document, api);
  vm.runInContext(readFileSync("js/app.js", "utf8"), vm.createContext(global), { filename: "js/app.js" });

  const input = document.getElementById("cnj-input");
  input.value = "00013278820188260344";
  await input.dispatch("input");
  await achar(document.getElementById("resultado"), (node) => node.className === "btn-consultar").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const online = document.getElementById("resultado-online");
  const texto = online.textContent;
  assert.match(texto, /Faixa de prioridade/);
  assert.match(texto, /Prioridade média/);
  assert.match(texto, /confiança baixa/);
  assert.match(texto, /45 ponto\(s\)/);
  assert.match(texto, /pesos semente pendentes de aprovação da área de risco/);
  // Cada fator explica a própria pontuação — é o que torna a regra auditável.
  assert.match(texto, /estagio_tpu/);
  assert.match(texto, /Nenhum movimento com código TPU curado/);
  assert.match(texto, /score-2026-09-08-semente-1/);
  assert.match(texto, /indicio_publico_datajud/);
  assert.ok(achar(online, (node) => node.className === "score"), "a faixa mora no próprio bloco");
});

test("resposta sem score não desenha bloco de faixa nenhum", async () => {
  const document = documentoFake();
  const api = {
    verificarSessao: async () => true,
    iniciarSso() {},
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => ({ encontrado: true, total: 1, processos: [{ grau: "G1", movimentos: [] }] }),
  };
  const global = contexto(document, api);
  vm.runInContext(readFileSync("js/app.js", "utf8"), vm.createContext(global), { filename: "js/app.js" });

  const input = document.getElementById("cnj-input");
  input.value = "00013278820188260344";
  await input.dispatch("input");
  await achar(document.getElementById("resultado"), (node) => node.className === "btn-consultar").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const online = document.getElementById("resultado-online");
  assert.equal(achar(online, (node) => node.className === "score"), null);
  assert.equal(online.textContent.includes("Faixa de prioridade"), false);
});
