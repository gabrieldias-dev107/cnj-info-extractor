// Liga a lógica CNJ ao DOM: máscara em tempo real, render dos cards, exemplos clicáveis.
// Script clássico. Depende de window.CNJ.
(function (global) {
  "use strict";
  var C = global.CNJ;
  var T = global.CNJ_TABLES;
  var Api = global.CNJApi;
  var doc = global.document;

  var input, resultado, resultadoOnline, contador;

  // Reaplica a máscara e mantém o cursor no fim (suficiente p/ digitação normal).
  function aoDigitar() {
    var digitos = C.normalize(input.value).slice(0, 20);
    input.value = C.format(digitos);
    contador.textContent = digitos.length + "/20 dígitos";
    render(digitos);
  }

  function render(digitos) {
    limparOnline(); // qualquer mudança no número descarta dado online anterior

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

    montarBotaoConsulta(d);
  }

  // Cria o botão "Consultar online" (só faz sentido com número válido).
  // Sem alias para o segmento => botão desabilitado com nota.
  function montarBotaoConsulta(d) {
    var wrap = doc.createElement("div");
    wrap.className = "consulta-online-acao";

    var btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "btn-consultar";
    btn.textContent = "Consultar online";

    var alias = T.deriveAlias(d.segmento, d.tribunal).alias;
    if (!d.valido) {
      btn.disabled = true;
      btn.title = "Número com dígito verificador inválido.";
    } else if (!alias) {
      btn.disabled = true;
      var nota = doc.createElement("span");
      nota.className = "consulta-nota";
      nota.textContent = "Consulta online indisponível para este segmento.";
      wrap.appendChild(btn);
      wrap.appendChild(nota);
      resultado.appendChild(wrap);
      return;
    }

    btn.addEventListener("click", function () { consultarOnline(d.digitos); });
    wrap.appendChild(btn);
    resultado.appendChild(wrap);
  }

  async function consultarOnline(digitos) {
    setOnlineEstado("carregando");
    try {
      var r = await Api.consultarProcesso(digitos);
      if (!r.encontrado) {
        setOnlineEstado("vazio", "Processo não encontrado na base pública do DataJud.");
        return;
      }
      renderOnline(r.processo, !!r._cache);
    } catch (e) {
      setOnlineEstado("erro", mensagemErro(e && e.message));
    }
  }

  function setOnlineEstado(estado, msg) {
    resultadoOnline.className = "resultado-online " + estado;
    if (estado === "carregando") {
      resultadoOnline.innerHTML =
        "<div class=\"online-status\"><span class=\"spinner\" aria-hidden=\"true\"></span>" +
        "Consultando DataJud…</div>";
    } else if (estado === "vazio") {
      resultadoOnline.innerHTML = "<p class=\"online-vazio\">" + escapeHtml(msg) + "</p>";
    } else if (estado === "erro") {
      resultadoOnline.innerHTML = "<p class=\"online-erro\">" + escapeHtml(msg) + "</p>";
    }
  }

  function limparOnline() {
    if (!resultadoOnline) return;
    resultadoOnline.className = "resultado-online vazio";
    resultadoOnline.innerHTML = "";
  }

  function mensagemErro(code) {
    switch (code) {
      case "alias_desconhecido":
      case "alias_invalido":
        return "Consulta online indisponível para este segmento.";
      case "numero_invalido":
        return "Número do processo inválido.";
      case "timeout":
        return "A consulta demorou demais. Tente novamente.";
      case "network":
      case "erro_servidor":
      case "datajud_http":
        return "Não foi possível consultar o DataJud agora. Tente novamente em instantes.";
      default:
        return "Não foi possível concluir a consulta.";
    }
  }

  var LIMITE_MOV = 20;

  function renderOnline(p, fromCache) {
    var assuntos = (p.assuntos || []).map(function (a) { return a && a.nome; })
      .filter(Boolean).join(", ");
    var classe = (p.classe && p.classe.nome) || "—";
    var orgao = (p.orgaoJulgador && p.orgaoJulgador.nome) || "—";
    var tribGrau = escapeHtml(p.tribunal || "—") +
      (p.grau ? " <span class=\"badge badge-warn\">" + escapeHtml(p.grau) + "</span>" : "");

    var cards = [
      card("Classe", escapeHtml(classe), "Classe processual (CNJ)."),
      card("Assuntos", escapeHtml(assuntos || "—"), "Assuntos vinculados ao processo."),
      card("Órgão julgador", escapeHtml(orgao), "Vara/órgão responsável."),
      card("Tribunal / Grau", tribGrau, "Tribunal e grau de jurisdição."),
      card("Ajuizamento", formatarData(p.dataAjuizamento), "Data de autuação registrada no tribunal."),
      card("Última atualização", formatarData(p.dataHoraUltimaAtualizacao, true), "Última movimentação enviada ao DataJud."),
    ];

    var badge = fromCache ? " <span class=\"badge badge-warn\">dados em cache</span>" : "";

    resultadoOnline.className = "resultado-online ok";
    resultadoOnline.innerHTML =
      "<p class=\"titulo-resultado\">Dados do processo (DataJud)" + badge + "</p>" +
      "<div class=\"cards\">" + cards.join("") + "</div>" +
      timelineHtml(p.movimentos || []);

    ligarMostrarMais();
  }

  function timelineHtml(movs) {
    if (!movs.length) return "<p class=\"online-vazio\">Sem movimentações registradas.</p>";

    var visiveis = movs.slice(0, LIMITE_MOV);
    var ocultos = movs.slice(LIMITE_MOV);

    var html = "<h3 class=\"online-sub\">Movimentações</h3><ol class=\"timeline\">";
    html += visiveis.map(itemMov).join("");
    if (ocultos.length) {
      html += "<span class=\"mov-extra\" hidden>" + ocultos.map(itemMov).join("") + "</span>";
    }
    html += "</ol>";
    if (ocultos.length) {
      html += "<button type=\"button\" class=\"mostrar-mais\">Mostrar mais (" + ocultos.length + ")</button>";
    }
    return html;
  }

  function itemMov(m) {
    return "<li><span class=\"mov-nome\">" + escapeHtml(m.nome || "—") + "</span>" +
      "<span class=\"data\">" + formatarData(m.dataHora, true) + "</span></li>";
  }

  function ligarMostrarMais() {
    var btn = resultadoOnline.querySelector(".mostrar-mais");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var extra = resultadoOnline.querySelector(".mov-extra");
      if (extra) extra.hidden = false;
      btn.remove();
    });
  }

  // Formata data -> "dd/mm/aaaa" (com hora opcional). Aceita dois formatos do
  // DataJud: ISO 8601 (ex.: dataHoraUltimaAtualizacao, movimentos) e numérico
  // AAAAMMDDHHMMSS (ex.: dataAjuizamento). Guarda contra null/invalid.
  function formatarData(valor, comHora) {
    if (!valor) return "—";
    var p2 = function (n) { return String(n).padStart(2, "0"); };

    // Formato numérico AAAAMMDD[HHMMSS]
    var num = String(valor);
    if (/^\d{8,14}$/.test(num)) {
      var ano = num.slice(0, 4), mes = num.slice(4, 6), dia = num.slice(6, 8);
      var s = dia + "/" + mes + "/" + ano;
      if (comHora && num.length >= 12) s += " " + num.slice(8, 10) + ":" + num.slice(10, 12);
      return s;
    }

    var dt = new Date(valor);
    if (isNaN(dt.getTime())) return "—";
    var out = p2(dt.getDate()) + "/" + p2(dt.getMonth() + 1) + "/" + dt.getFullYear();
    if (comHora) out += " " + p2(dt.getHours()) + ":" + p2(dt.getMinutes());
    return out;
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
    resultadoOnline = doc.getElementById("resultado-online");
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
