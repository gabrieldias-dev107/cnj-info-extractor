// Cliente das rotas de consolidação P1: carteiras, processos monitorados,
// membros, sondas de saúde e histórico do processo.
// Script clássico, sem dependências. Expõe window.P1Api.
//
// Todas as rotas exigem sessão SSO e cookie de mesma origem — o mesmo contrato
// de js/api.js. Falha vira Error(codigo), traduzido para PT-BR na interface.
(function (global) {
  "use strict";

  // Espelho exato de requisicaoLote() em js/api.js: sessão expirada tem código
  // próprio para a interface saber que deve mandar o usuário ao Entra, em vez
  // de mostrar "erro do servidor" para quem só precisa entrar de novo.
  async function requisicao(url, method, dados) {
    var opcoes = { method: method, credentials: "same-origin" };
    if (dados) {
      opcoes.headers = { "Content-Type": "application/json" };
      opcoes.body = JSON.stringify(dados);
    }
    var resp = await fetch(url, opcoes);
    var body;
    try { body = await resp.json(); } catch (e) { body = {}; }
    if (!resp.ok) {
      if (body && body.login === "sso") throw new Error("autenticacao_sso");
      throw new Error((body && body.error) || "erro_servidor");
    }
    return body;
  }

  function parametros(pares) {
    var partes = [];
    for (var i = 0; i < pares.length; i += 1) {
      partes.push(pares[i][0] + "=" + encodeURIComponent(String(pares[i][1])));
    }
    return "?" + partes.join("&");
  }

  var ROTA_PORTFOLIOS = "/api/portfolios";
  var ROTA_ITENS = "/api/portfolios/items";
  var ROTA_MEMBROS = "/api/portfolios/members";
  var ROTA_PROBES = "/api/health-probes";
  var ROTA_HISTORICO = "/api/process-history";

  // --- carteiras --------------------------------------------------------------

  function listarPortfolios() {
    return requisicao(ROTA_PORTFOLIOS, "GET");
  }

  function criarPortfolio(nome) {
    return requisicao(ROTA_PORTFOLIOS, "POST", { nome: nome });
  }

  function renomearPortfolio(id, nome) {
    return requisicao(ROTA_PORTFOLIOS, "PATCH", { id: id, nome: nome });
  }

  function removerPortfolio(id) {
    return requisicao(ROTA_PORTFOLIOS + parametros([["id", id]]), "DELETE");
  }

  // --- processos monitorados --------------------------------------------------

  // `processId` é o identificador do processo já consultado, não o número CNJ:
  // o vínculo é com a linha que o DataJud já devolveu alguma vez.
  function listarItens(portfolioId) {
    return requisicao(ROTA_ITENS + parametros([["portfolioId", portfolioId]]), "GET");
  }

  function adicionarItem(portfolioId, processId, intervaloMinutos) {
    return requisicao(ROTA_ITENS, "POST", {
      portfolioId: portfolioId,
      processId: processId,
      intervaloMinutos: intervaloMinutos,
    });
  }

  function atualizarItem(portfolioId, id, intervaloMinutos) {
    return requisicao(ROTA_ITENS, "PATCH", {
      portfolioId: portfolioId,
      id: id,
      intervaloMinutos: intervaloMinutos,
    });
  }

  function removerItem(portfolioId, id) {
    return requisicao(ROTA_ITENS + parametros([["portfolioId", portfolioId], ["id", id]]), "DELETE");
  }

  // --- membros ----------------------------------------------------------------

  function listarMembros(portfolioId) {
    return requisicao(ROTA_MEMBROS + parametros([["portfolioId", portfolioId]]), "GET");
  }

  function adicionarMembro(portfolioId, email) {
    return requisicao(ROTA_MEMBROS, "POST", { portfolioId: portfolioId, email: email });
  }

  function removerMembro(portfolioId, userId) {
    return requisicao(ROTA_MEMBROS + parametros([["portfolioId", portfolioId], ["userId", userId]]), "DELETE");
  }

  // --- sondas de saúde --------------------------------------------------------

  // O corpo leva o número do processo; o índice do DataJud é escolhido pelo
  // servidor a partir dele. O cliente não opina sobre isso.
  function listarProbes(portfolioId) {
    return requisicao(ROTA_PROBES + parametros([["portfolioId", portfolioId]]), "GET");
  }

  function criarProbe(portfolioId, numero, intervaloMinutos) {
    return requisicao(ROTA_PROBES, "POST", {
      portfolioId: portfolioId,
      numero: numero,
      intervaloMinutos: intervaloMinutos,
    });
  }

  function atualizarProbe(portfolioId, id, dados) {
    var corpo = { portfolioId: portfolioId, id: id, intervaloMinutos: (dados || {}).intervaloMinutos };
    if (dados && dados.numero !== undefined) corpo.numero = dados.numero;
    return requisicao(ROTA_PROBES, "PATCH", corpo);
  }

  function removerProbe(portfolioId, id) {
    return requisicao(ROTA_PROBES + parametros([["portfolioId", portfolioId], ["id", id]]), "DELETE");
  }

  // --- histórico --------------------------------------------------------------

  function consultarHistorico(numero) {
    var digitos = String(numero || "").replace(/\D/g, "");
    if (digitos.length !== 20) return Promise.reject(new Error("numero_invalido"));
    return requisicao(ROTA_HISTORICO + parametros([["numero", digitos]]), "GET");
  }

  global.P1Api = {
    listarPortfolios: listarPortfolios,
    criarPortfolio: criarPortfolio,
    renomearPortfolio: renomearPortfolio,
    removerPortfolio: removerPortfolio,
    listarItens: listarItens,
    adicionarItem: adicionarItem,
    atualizarItem: atualizarItem,
    removerItem: removerItem,
    listarMembros: listarMembros,
    adicionarMembro: adicionarMembro,
    removerMembro: removerMembro,
    listarProbes: listarProbes,
    criarProbe: criarProbe,
    atualizarProbe: atualizarProbe,
    removerProbe: removerProbe,
    consultarHistorico: consultarHistorico,
  };
})(typeof window !== "undefined" ? window : globalThis);
