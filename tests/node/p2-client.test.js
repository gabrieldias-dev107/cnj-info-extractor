import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { achar, documentoFake, todos } from "./helpers/dom.js";

// Contexto mínimo para rodar js/p2-api.js e js/p2-ui.js sob vm, como os testes
// de cliente do P1 já fazem.
function contexto({ document, fetchImpl, p1Ui, cnjApi } = {}) {
  const global = {
    document: document || documentoFake(),
    fetch: fetchImpl,
    P1Ui: p1Ui || { mensagemErro: (codigo) => "herdada:" + codigo },
    CNJApi: cnjApi || { iniciarSso() {} },
    Date,
    setTimeout,
    clearTimeout,
  };
  global.window = global;
  global.globalThis = global;
  const contextoVm = vm.createContext(global);
  vm.runInContext(readFileSync("js/p2-api.js", "utf8"), contextoVm, { filename: "js/p2-api.js" });
  return global;
}

function resposta(status, corpo) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

function carregarUi(global) {
  vm.runInContext(readFileSync("js/p2-ui.js", "utf8"), vm.createContext(global), { filename: "js/p2-ui.js" });
}

async function assentar() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// --- cliente ----------------------------------------------------------------

test("cliente P2 usa cookie de mesma origem e nunca manda Authorization", async () => {
  const chamadas = [];
  const global = contexto({
    fetchImpl: async (url, opcoes) => { chamadas.push([url, opcoes]); return resposta(200, { tokens: [] }); },
  });

  await global.P2Api.listarTokens();
  await global.P2Api.listarAuditoria({ limite: 10, offset: 20 });

  assert.equal(chamadas[0][0], "/api/service-tokens");
  assert.equal(chamadas[0][1].credentials, "same-origin");
  assert.equal(chamadas[1][0], "/api/audit?limite=10&offset=0".replace("offset=0", "offset=20"));
  for (const [, opcoes] of chamadas) {
    assert.equal(JSON.stringify(opcoes.headers || {}).toLowerCase().includes("authorization"), false);
  }
});

// Um token em JavaScript de navegador fica exposto a qualquer pessoa com o
// DevTools aberto — e este arquivo é servido publicamente.
test("nenhum cliente do navegador chama /api/v1 nem monta header Bearer", () => {
  for (const caminho of ["js/p2-api.js", "js/p2-ui.js", "js/p1-api.js", "js/api.js", "js/app.js"]) {
    const fonte = readFileSync(caminho, "utf8");
    // A aspa antes do caminho é o que distingue chamada de menção em texto: as
    // duas rotas aparecem na ajuda da tela, e isso é desejável.
    assert.equal(/["'`]\/api\/v1\//.test(fonte), false, caminho + " não pode chamar /api/v1");
    assert.equal(/["']Authorization["']\s*:/.test(fonte), false, caminho + " não pode montar Bearer");
  }
});

test("sessão expirada vira autenticacao_sso; erro do servidor preserva o código", async () => {
  const expirada = contexto({ fetchImpl: async () => resposta(401, { error: "autenticacao_necessaria", login: "sso" }) });
  await assert.rejects(() => expirada.P2Api.listarTokens(), /autenticacao_sso/);

  const recusada = contexto({ fetchImpl: async () => resposta(404, { error: "token_nao_encontrado" }) });
  await assert.rejects(() => recusada.P2Api.revogarToken("tok-1"), /token_nao_encontrado/);
});

test("revogação aceita 204 sem corpo", async () => {
  const global = contexto({ fetchImpl: async () => ({ ok: true, status: 204, json: async () => { throw new Error("sem corpo"); } }) });
  // O objeto nasce dentro do vm, então tem outro Object.prototype: comparar as
  // chaves é o que importa aqui.
  assert.deepEqual(Object.keys(await global.P2Api.revogarToken("tok-1")), []);
});

test("limite vazio não vira zero no corpo da emissão", async () => {
  const corpos = [];
  const global = contexto({
    fetchImpl: async (_url, opcoes) => { corpos.push(JSON.parse(opcoes.body)); return resposta(201, {}); },
  });

  await global.P2Api.emitirToken("integração", "");
  await global.P2Api.emitirToken("integração", null);
  await global.P2Api.emitirToken("integração", 500);

  assert.deepEqual(corpos, [{ nome: "integração" }, { nome: "integração" }, { nome: "integração", limiteDia: 500 }]);
});

// --- interface --------------------------------------------------------------

test("painel de tokens lista sem repetir o segredo e mostra o valor emitido uma vez", async () => {
  const document = documentoFake();
  const global = contexto({
    document,
    fetchImpl: async (url, opcoes) => {
      if (url.startsWith("/api/audit")) return resposta(200, { eventos: [], total: 0 });
      if (opcoes.method === "POST") {
        return resposta(201, { id: "tok-1", nome: "integração", prefixo: "abcdefgh", limiteDia: 500, criadoEm: null, ultimoUsoEm: null, revogadoEm: null, expiresAt: null, token: "cnjsvc_abcdefgh_segredo" });
      }
      return resposta(200, { tokens: [{ id: "tok-1", nome: "integração", prefixo: "abcdefgh", limiteDia: 500, criadoEm: "2026-09-08T10:00:00.000Z", ultimoUsoEm: null, revogadoEm: null, expiresAt: null }] });
    },
  });
  carregarUi(global);
  await assentar();

  const lista = document.getElementById("tokens-lista");
  assert.match(lista.textContent, /integração/);
  assert.match(lista.textContent, /abcdefgh/);
  assert.equal(lista.textContent.includes("cnjsvc_abcdefgh_segredo"), false, "a listagem nunca repete o segredo");

  document.getElementById("token-nome").value = "integração";
  await document.getElementById("token-form").dispatch("submit");
  await assentar();

  const emitido = document.getElementById("token-emitido");
  assert.equal(emitido.hidden, false);
  assert.match(emitido.textContent, /cnjsvc_abcdefgh_segredo/);
  assert.match(emitido.textContent, /não será exibido de novo/);
});

test("painel de tokens recusa nome vazio antes de chamar o servidor", async () => {
  const document = documentoFake();
  let chamadasPost = 0;
  const global = contexto({
    document,
    fetchImpl: async (url, opcoes) => {
      if (opcoes.method === "POST") chamadasPost += 1;
      if (url.startsWith("/api/audit")) return resposta(200, { eventos: [], total: 0 });
      return resposta(200, { tokens: [] });
    },
  });
  carregarUi(global);
  await assentar();

  document.getElementById("token-nome").value = "   ";
  await document.getElementById("token-form").dispatch("submit");
  await assentar();

  assert.equal(chamadasPost, 0);
  assert.match(document.getElementById("tokens-status").textContent, /Dê um nome ao token/);
});

test("trilha renderiza eventos por nó e traduz a ação sem inventar código novo", async () => {
  const document = documentoFake();
  const global = contexto({
    document,
    fetchImpl: async (url) => {
      if (url.startsWith("/api/audit")) {
        return resposta(200, {
          eventos: [
            { id: "e1", ator: "t_abcdefgh", atorTipo: "token", acao: "api_v1", recurso: "processos", resultado: "sucesso_cache", processId: "proc-1", serviceTokenId: "tok-1", reqId: null, createdAt: "2026-09-08T10:00:00.000Z" },
            { id: "e2", ator: "u_deadbeef", atorTipo: "usuario", acao: "acao_que_ainda_nao_existe", recurso: null, resultado: "negado_origem", processId: null, serviceTokenId: null, reqId: null, createdAt: "2026-09-08T09:00:00.000Z" },
          ],
          total: 2,
        });
      }
      return resposta(200, { tokens: [] });
    },
  });
  carregarUi(global);
  await assentar();

  const lista = document.getElementById("trilha-lista");
  assert.match(lista.textContent, /Chamada da API interna/);
  assert.match(lista.textContent, /sucesso_cache/);
  // Código desconhecido aparece como veio: traduzir por adivinhação esconderia
  // um evento novo em vez de mostrá-lo.
  assert.match(lista.textContent, /acao_que_ainda_nao_existe/);
  assert.match(document.getElementById("trilha-status").textContent, /2 evento\(s\)/);
  // Nada é montado como markup: o DOM falso não interpreta HTML.
  assert.equal(achar(lista, (node) => node.tagName === "SCRIPT"), null);
  assert.ok(todos(lista, (node) => node.tagName === "TD").length >= 10);
});

test("paginação da trilha não anda para trás do começo nem além do total", async () => {
  const document = documentoFake();
  const pedidos = [];
  const global = contexto({
    document,
    fetchImpl: async (url) => {
      if (url.startsWith("/api/audit")) { pedidos.push(url); return resposta(200, { eventos: [], total: 30 }); }
      return resposta(200, { tokens: [] });
    },
  });
  carregarUi(global);
  await assentar();

  assert.equal(document.getElementById("trilha-anterior").disabled, true);
  assert.equal(document.getElementById("trilha-proxima").disabled, false);

  await document.getElementById("trilha-proxima").click();
  await assentar();
  assert.match(pedidos[pedidos.length - 1], /offset=25/);
  assert.equal(document.getElementById("trilha-proxima").disabled, true, "30 eventos cabem em duas páginas de 25");

  await document.getElementById("trilha-anterior").click();
  await assentar();
  assert.match(pedidos[pedidos.length - 1], /offset=0/);
});

// Abrir a ferramenta é público: o decodificador offline não pode empurrar
// ninguém para o Entra.
test("carga inicial sem sessão mostra botão Entrar em vez de redirecionar", async () => {
  const document = documentoFake();
  let redirecionou = 0;
  const global = contexto({
    document,
    cnjApi: { iniciarSso() { redirecionou += 1; } },
    fetchImpl: async () => resposta(401, { error: "autenticacao_necessaria", login: "sso" }),
  });
  carregarUi(global);
  await assentar();

  assert.equal(redirecionou, 0);
  const status = document.getElementById("tokens-status");
  assert.match(status.textContent, /Sua sessão não está ativa/);
  assert.ok(achar(status, (node) => node.className === "p1-entrar"), "precisa oferecer o botão Entrar");
  assert.equal(document.getElementById("token-form").hidden, true, "sem sessão não se oferece formulário de emissão");
});

test("mensagem desconhecida cai na tabela do P1 antes do texto genérico", () => {
  const global = contexto({ fetchImpl: async () => resposta(200, {}) });
  carregarUi(global);

  assert.match(global.P2Ui.mensagemErro("limite_invalido"), /número inteiro entre 1 e 10000/);
  assert.equal(global.P2Ui.mensagemErro("portfolio_indisponivel"), "herdada:portfolio_indisponivel");
});
