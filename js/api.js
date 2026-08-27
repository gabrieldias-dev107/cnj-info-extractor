// Cliente da consulta online (DataJud) via proxy /api/datajud.
// Script clássico. Depende de window.CNJ_TABLES (deriveAlias).
// Expõe window.CNJApi.consultarProcesso(digitos) -> Promise<resposta>.
//
// Contrato da resposta: { encontrado, total, processos: [...] }.
// O mesmo número pode existir em mais de um grau — por isso é lista, não item.
(function (global) {
  "use strict";
  var T = global.CNJ_TABLES;

  // v2: o formato mudou de { processo } para { processos }. Trocar o prefixo
  // descarta as entradas antigas sem precisar de código de migração.
  var CACHE_PREFIX = "datajud:v2:";
  var TTL_MS = 24 * 60 * 60 * 1000; // 24h

  function lerCache(digitos) {
    try {
      var raw = global.localStorage.getItem(CACHE_PREFIX + digitos);
      if (!raw) return null;
      var item = JSON.parse(raw);
      if (!item || (Date.now() - item.ts) > TTL_MS) return null;
      return item.data;
    } catch (e) {
      return null; // localStorage indisponível (modo privado/quota) — segue sem cache
    }
  }

  function gravarCache(digitos, data) {
    try {
      global.localStorage.setItem(
        CACHE_PREFIX + digitos,
        JSON.stringify({ ts: Date.now(), data: data })
      );
    } catch (e) { /* best-effort */ }
  }

  async function requisicaoSessao(method, body) {
    var opcoes = { method: method, credentials: "same-origin" };
    if (body) {
      opcoes.headers = { "Content-Type": "application/json" };
      opcoes.body = JSON.stringify(body);
    }
    var resp = await fetch("/api/session", opcoes);
    if (resp.ok) return true;
    var retorno;
    try { retorno = await resp.json(); } catch (e) { retorno = {}; }
    if (retorno && retorno.login === "sso") throw new Error("autenticacao_sso");
    throw new Error((retorno && retorno.error) || "erro_servidor");
  }

  function verificarSessao() {
    return requisicaoSessao("GET");
  }

  function entrar(senha) {
    return requisicaoSessao("POST", { senha: senha });
  }

  function iniciarSso() {
    global.location.href = "/api/auth/login";
  }

  function limparCache() {
    try {
      for (var i = global.localStorage.length - 1; i >= 0; i--) {
        var chave = global.localStorage.key(i);
        if (chave && chave.indexOf(CACHE_PREFIX) === 0) global.localStorage.removeItem(chave);
      }
    } catch (e) { /* best-effort */ }
  }

  async function sair() {
    try { await requisicaoSessao("DELETE"); }
    finally { limparCache(); }
  }

  // Resolve os metadados do processo. Lança Error(codigo) em falha,
  // onde codigo é tratado pelo app.js para mensagem em PT-BR.
  async function consultarProcesso(digitos) {
    var d = String(digitos).replace(/\D/g, "");
    if (d.length !== 20) throw new Error("numero_invalido");

    // Cache online também é protegido: confirmar sessão antes de expor dados.
    await verificarSessao();

    var emCache = lerCache(d);
    if (emCache) {
      emCache._cache = true;
      return emCache;
    }

    var derivado = T.deriveAlias(d.slice(13, 14), d.slice(14, 16));
    if (!derivado.alias) throw new Error("alias_desconhecido");

    var resp = await fetch("/api/datajud", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: d, alias: derivado.alias }),
    });

    var body;
    try { body = await resp.json(); } catch (e) { body = {}; }

    if (!resp.ok) throw new Error((body && body.error) || "erro_servidor");

    gravarCache(d, body);
    return body;
  }

  async function requisicaoLote(url, method, dados) {
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

  function criarLote(numeros) {
    return requisicaoLote("/api/batches", "POST", { numeros: numeros });
  }

  function consultarLote(id) {
    return requisicaoLote("/api/batches?id=" + encodeURIComponent(id), "GET");
  }

  async function importarXlsx(arquivo) {
    var resp = await fetch("/api/batches/import", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      body: arquivo,
    });
    var body;
    try { body = await resp.json(); } catch (e) { body = {}; }
    if (!resp.ok) {
      if (body && body.login === "sso") throw new Error("autenticacao_sso");
      throw new Error((body && body.error) || "erro_servidor");
    }
    return body;
  }

  global.CNJApi = {
    consultarProcesso: consultarProcesso,
    verificarSessao: verificarSessao,
    entrar: entrar,
    iniciarSso: iniciarSso,
    sair: sair,
    criarLote: criarLote,
    consultarLote: consultarLote,
    importarXlsx: importarXlsx,
  };
})(typeof window !== "undefined" ? window : globalThis);
