// Testes da lógica pura de CNJ. Script clássico. Depende de window.CNJ.
// Expõe window.CNJ_TESTS.runAll() -> [{ nome, ok, detalhe }].
(function (global) {
  "use strict";
  var C = global.CNJ;

  var casos = [];
  function t(nome, fn) { casos.push({ nome: nome, fn: fn }); }
  function eq(a, b) { if (a !== b) throw new Error("esperado " + JSON.stringify(b) + ", obtido " + JSON.stringify(a)); }
  function ok(v) { if (!v) throw new Error("esperado verdadeiro"); }
  function notOk(v) { if (v) throw new Error("esperado falso"); }

  // --- normalize ---
  t("normalize remove pontuação", function () {
    eq(C.normalize("0001327-88.2018.8.26.0344"), "00013278820188260344");
  });
  t("normalize de string vazia", function () { eq(C.normalize(""), ""); });
  t("normalize de null", function () { eq(C.normalize(null), ""); });

  // --- format (máscara progressiva) ---
  t("format parcial 4 dígitos", function () { eq(C.format("0001"), "0001"); });
  t("format adiciona hífen no 8º dígito", function () { eq(C.format("000132788"), "0001327-88"); });
  t("format completo", function () { eq(C.format("00013278820188260344"), "0001327-88.2018.8.26.0344"); });
  t("format ignora pontuação na entrada", function () { eq(C.format("0001327-88.2018"), "0001327-88.2018"); });
  t("format limita a 20 dígitos", function () { eq(C.format("000132788201882603449999"), "0001327-88.2018.8.26.0344"); });

  // --- parse ---
  t("parse < 20 dígitos retorna null", function () { eq(C.parse("123"), null); });
  t("parse separa os campos", function () {
    var p = C.parse("0001327-88.2018.8.26.0344");
    eq(p.sequencial, "0001327");
    eq(p.verificador, "88");
    eq(p.ano, "2018");
    eq(p.segmento, "8");
    eq(p.tribunal, "26");
    eq(p.origem, "0344");
  });

  // --- validate (vetores válidos gerados com o algoritmo oficial) ---
  var VALIDOS = [
    "0001327-88.2018.8.26.0344", // TJSP
    "0010500-52.2019.5.02.0011", // TRT 2ª
    "0002250-82.2021.4.03.6100", // TRF 3ª
    "0000600-20.2022.6.26.0001", // TRE-SP
    "0000123-43.2020.3.00.0000", // STJ
  ];
  VALIDOS.forEach(function (n) {
    t("validate aceita " + n, function () { ok(C.validate(C.parse(n))); });
  });
  t("validate rejeita dígito alterado", function () {
    notOk(C.validate(C.parse("0001327-89.2018.8.26.0344")));
  });
  t("digitoEsperado recalcula corretamente", function () {
    eq(C.digitoEsperado(C.parse("0001327-00.2018.8.26.0344")), "88");
  });

  // --- describe ---
  t("describe mapeia segmento e tribunal estadual", function () {
    var d = C.describe("0001327-88.2018.8.26.0344");
    eq(d.segmentoNome, "Justiça Estadual");
    eq(d.tribunalNome, "Tribunal de Justiça (TJSP)");
    ok(d.valido);
    ok(d.tribunalConhecido);
  });
  t("describe mapeia TRT com UF", function () {
    eq(C.describe("0010500-52.2019.5.02.0011").tribunalNome, "TRT da 2ª Região (SP)");
  });
  t("describe TRT 8ª cobre PA/AP", function () {
    var dv = C.digitoEsperado(C.parse("0010500-00.2019.5.08.0011"));
    eq(C.describe("0010500-" + dv + ".2019.5.08.0011").tribunalNome, "TRT da 8ª Região (PA/AP)");
  });
  t("describe mapeia TRE", function () {
    eq(C.describe("0000600-20.2022.6.26.0001").tribunalNome, "TRE-SP");
  });
  t("describe marca tribunal desconhecido (TR inexistente)", function () {
    var dvFix = C.digitoEsperado(C.parse("0000123-00.2020.8.99.0000"));
    var d = C.describe("0000123-" + dvFix + ".2020.8.99.0000");
    notOk(d.tribunalConhecido);
  });

  function runAll() {
    return casos.map(function (c) {
      try { c.fn(); return { nome: c.nome, ok: true, detalhe: "" }; }
      catch (e) { return { nome: c.nome, ok: false, detalhe: e.message }; }
    });
  }

  global.CNJ_TESTS = { runAll: runAll };
})(typeof window !== "undefined" ? window : globalThis);
