// Liga a lógica CNJ ao DOM: máscara em tempo real, render dos cards, exemplos clicáveis.
// Script clássico. Depende de window.CNJ.
(function (global) {
  "use strict";
  var C = global.CNJ;
  var doc = global.document;

  var input, resultado, contador;

  // Reaplica a máscara e mantém o cursor no fim (suficiente p/ digitação normal).
  function aoDigitar() {
    var digitos = C.normalize(input.value).slice(0, 20);
    input.value = C.format(digitos);
    contador.textContent = digitos.length + "/20 dígitos";
    render(digitos);
  }

  function render(digitos) {
    if (digitos.length < 20) {
      resultado.innerHTML = "";
      resultado.className = "resultado vazio";
      if (digitos.length > 0) {
        resultado.innerHTML = "<p class=\"dica\">Continue digitando — faltam " +
          (20 - digitos.length) + " dígito(s).</p>";
      }
      return;
    }

    var d = C.describe(digitos);
    resultado.className = "resultado " + (d.valido ? "ok" : "invalido");

    var statusDV = d.valido
      ? "<span class=\"badge badge-ok\">válido</span>"
      : "<span class=\"badge badge-erro\">inválido — esperado " + d.digitoEsperado + "</span>";

    var cards = [
      card("Número sequencial", d.sequencial, "Identificador do processo na unidade de origem, por ano."),
      card("Dígito verificador", d.verificador + " " + statusDV, "Confere a integridade do número (ISO 7064, módulo 97)."),
      card("Ano de autuação", d.ano, "Ano em que o processo foi protocolado."),
      card("Segmento da Justiça", escapeHtml(d.segmentoNome), "Ramo do Poder Judiciário (dígito J)."),
      card("Tribunal", escapeHtml(d.tribunalNome) + (d.tribunalConhecido ? "" : " <span class=\"badge badge-warn\">não mapeado</span>"), "Tribunal responsável (código TR)."),
      card("Unidade de origem", d.origem, "Código da vara/foro de origem (nome não disponível offline)."),
    ];

    resultado.innerHTML =
      "<p class=\"titulo-resultado\">" + escapeHtml(d.formatado) + "</p>" +
      "<div class=\"cards\">" + cards.join("") + "</div>";
  }

  function card(rotulo, valor, ajuda) {
    return "<div class=\"card\">" +
      "<div class=\"rotulo\">" + rotulo + "</div>" +
      "<div class=\"valor\">" + valor + "</div>" +
      "<div class=\"ajuda\">" + ajuda + "</div>" +
      "</div>";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function usarExemplo(numero) {
    input.value = numero;
    aoDigitar();
    input.focus();
  }

  function init() {
    input = doc.getElementById("cnj-input");
    resultado = doc.getElementById("resultado");
    contador = doc.getElementById("contador");

    input.addEventListener("input", aoDigitar);

    var exemplos = doc.querySelectorAll("[data-exemplo]");
    Array.prototype.forEach.call(exemplos, function (btn) {
      btn.addEventListener("click", function () {
        usarExemplo(btn.getAttribute("data-exemplo"));
      });
    });

    aoDigitar(); // estado inicial
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
