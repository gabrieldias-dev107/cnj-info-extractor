// Cliente da consulta online (DataJud) via proxy /api/datajud.
// Script clássico. Depende de window.CNJ_TABLES (deriveAlias).
// Expõe window.CNJApi.consultarProcesso(digitos) -> Promise<resposta>.
(function (global) {
  "use strict";
  var T = global.CNJ_TABLES;

  var CACHE_PREFIX = "datajud:";
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

  // Resolve os metadados do processo. Lança Error(codigo) em falha,
  // onde codigo é tratado pelo app.js para mensagem em PT-BR.
  async function consultarProcesso(digitos) {
    var d = String(digitos).replace(/\D/g, "");
    if (d.length !== 20) throw new Error("numero_invalido");

    var emCache = lerCache(d);
    if (emCache) {
      emCache._cache = true;
      return emCache;
    }

    var derivado = T.deriveAlias(d.slice(13, 14), d.slice(14, 16));
    if (!derivado.alias) throw new Error("alias_desconhecido");

    var resp = await fetch("/api/datajud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: d, alias: derivado.alias }),
    });

    var body;
    try { body = await resp.json(); } catch (e) { body = {}; }

    if (!resp.ok) throw new Error((body && body.error) || "erro_servidor");

    gravarCache(d, body);
    return body;
  }

  global.CNJApi = { consultarProcesso: consultarProcesso };
})(typeof window !== "undefined" ? window : globalThis);
