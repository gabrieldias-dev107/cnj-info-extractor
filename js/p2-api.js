// Cliente das rotas P2 de sessão: tokens de serviço e trilha de auditoria.
// Script clássico, sem dependências. Expõe window.P2Api.
//
// As rotas /api/v1/* NÃO têm cliente aqui de propósito: elas são para
// servidor-a-servidor, autenticadas por token de serviço. Um token colocado em
// JavaScript de navegador estaria exposto a qualquer pessoa com o DevTools
// aberto, e este arquivo é servido publicamente.
(function (global) {
  "use strict";

  // Espelho de js/p1-api.js: sessão expirada tem código próprio para a interface
  // mandar o usuário ao Entra em vez de mostrar "erro do servidor".
  async function requisicao(url, method, dados) {
    var opcoes = { method: method, credentials: "same-origin" };
    if (dados) {
      opcoes.headers = { "Content-Type": "application/json" };
      opcoes.body = JSON.stringify(dados);
    }
    var resp = await fetch(url, opcoes);
    if (resp.status === 204) return {};
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

  var ROTA_TOKENS = "/api/service-tokens";
  var ROTA_AUDITORIA = "/api/audit";

  // --- tokens de serviço ------------------------------------------------------

  function listarTokens() {
    return requisicao(ROTA_TOKENS, "GET");
  }

  // O valor em claro volta só nesta resposta. Quem perder não recupera: o banco
  // guarda apenas o hash.
  function emitirToken(nome, limiteDia) {
    var corpo = { nome: nome };
    if (limiteDia !== undefined && limiteDia !== null && limiteDia !== "") corpo.limiteDia = Number(limiteDia);
    return requisicao(ROTA_TOKENS, "POST", corpo);
  }

  function revogarToken(id) {
    return requisicao(ROTA_TOKENS + parametros([["id", id]]), "DELETE");
  }

  // --- trilha de auditoria ----------------------------------------------------

  function listarAuditoria(opcoes) {
    var pagina = opcoes || {};
    return requisicao(ROTA_AUDITORIA + parametros([
      ["limite", pagina.limite === undefined ? 25 : pagina.limite],
      ["offset", pagina.offset === undefined ? 0 : pagina.offset],
    ]), "GET");
  }

  global.P2Api = {
    listarTokens: listarTokens,
    emitirToken: emitirToken,
    revogarToken: revogarToken,
    listarAuditoria: listarAuditoria,
  };
})(typeof window !== "undefined" ? window : globalThis);
