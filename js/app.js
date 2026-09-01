// Liga a lógica CNJ ao DOM: máscara em tempo real, render dos cards, exemplos clicáveis.
// Script clássico. Depende de window.CNJ.
//
// Regra de segurança desta camada: dado vindo do DataJud NUNCA é concatenado em
// HTML. Tudo que vem da rede entra por textContent, em nós criados aqui.
// innerHTML não é usado em lugar nenhum deste arquivo.
(function (global) {
  "use strict";
  var C = global.CNJ;
  var T = global.CNJ_TABLES;
  var Api = global.CNJApi;
  var doc = global.document;

  var input, resultado, resultadoOnline, contador;
  var loginDialog, loginForm, loginPassword, loginError, loginSubmit, logoutButton;
  var batchForm, batchNumbers, batchFile, batchSubmit, batchStatus, batchItens, batchExport, batchExportXlsx, batchTimer;
  var consultaPendente = null;
  var focoAnterior = null;
  var consultaSeq = 0;

  // --- helpers de DOM ---------------------------------------------------------

  function el(tag, className, texto) {
    var n = doc.createElement(tag);
    if (className) n.className = className;
    if (texto != null) n.textContent = String(texto);
    return n;
  }

  function badge(texto, tipo) {
    return el("span", "badge badge-" + tipo, texto);
  }

  function limpar(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // Aceita string, Node ou array de ambos — evita ter que montar HTML só para
  // encostar um badge no valor de um card.
  function anexar(destino, valor) {
    if (valor == null) return;
    if (Array.isArray(valor)) {
      valor.forEach(function (v) { anexar(destino, v); });
    } else if (valor.nodeType) {
      destino.appendChild(valor);
    } else {
      destino.appendChild(doc.createTextNode(String(valor)));
    }
  }

  function card(rotulo, valor, ajuda) {
    var c = el("div", "card");
    c.appendChild(el("div", "rotulo", rotulo));
    var v = el("div", "valor");
    anexar(v, valor);
    c.appendChild(v);
    c.appendChild(el("div", "ajuda", ajuda));
    return c;
  }

  function grade(cards) {
    var g = el("div", "cards");
    cards.forEach(function (c) { g.appendChild(c); });
    return g;
  }

  // --- decodificação offline --------------------------------------------------

  // Reaplica a máscara e mantém o cursor no fim (suficiente p/ digitação normal).
  function aoDigitar() {
    var digitos = C.normalize(input.value).slice(0, 20);
    input.value = C.format(digitos);
    contador.textContent = digitos.length + "/20 dígitos";
    render(digitos);
  }

  function render(digitos) {
    limparOnline(); // qualquer mudança no número descarta dado online anterior
    limpar(resultado);

    if (digitos.length < 20) {
      resultado.className = "resultado vazio";
      if (digitos.length > 0) {
        resultado.appendChild(el("p", "dica",
          "Continue digitando — faltam " + (20 - digitos.length) + " dígito(s)."));
      }
      return;
    }

    var d = C.describe(digitos);
    resultado.className = "resultado " + (d.valido ? "ok" : "invalido");

    var statusDV = d.valido
      ? badge("válido", "ok")
      : badge("inválido — esperado " + d.digitoEsperado, "erro");

    var cards = [
      card("Número sequencial", d.sequencial, "Identificador do processo na unidade de origem, por ano."),
      card("Dígito verificador", [d.verificador + " ", statusDV], "Confere a integridade do número (ISO 7064, módulo 97)."),
      card("Ano de autuação", d.ano, "Ano em que o processo foi protocolado."),
      card("Segmento da Justiça", d.segmentoNome, "Ramo do Poder Judiciário (dígito J)."),
      card("Tribunal",
        d.tribunalConhecido ? d.tribunalNome : [d.tribunalNome + " ", badge("não mapeado", "warn")],
        "Tribunal responsável (código TR)."),
      card("Unidade de origem", d.origem, "Código da vara/foro de origem (nome não disponível offline)."),
    ];

    resultado.appendChild(el("p", "titulo-resultado", d.formatado));
    resultado.appendChild(grade(cards));

    anexarSugestoes(d);
    montarBotaoConsulta(d);
  }

  // Dígito verificador errado quase sempre é erro de digitação. Mostramos os
  // números próximos que passam no DV — como candidatos clicáveis, nunca como
  // correção automática: trocar o número do processo por conta própria é o tipo
  // de "ajuda" que faz alguém consultar o processo errado.
  function anexarSugestoes(d) {
    if (d.valido) return;
    var p1 = global.P1Ui;
    if (!p1 || !p1.blocoSugestoes) return;
    var bloco = p1.blocoSugestoes(d.digitos, function (numero) { usarExemplo(C.format(numero)); });
    if (bloco) resultado.appendChild(bloco);
  }

  // Cria o botão "Consultar online" (só faz sentido com número válido).
  // Sem alias para o segmento => botão desabilitado com nota.
  function montarBotaoConsulta(d) {
    var wrap = el("div", "consulta-online-acao");

    var btn = el("button", "btn-consultar", "Consultar online");
    btn.type = "button";

    var alias = T.deriveAlias(d.segmento, d.tribunal).alias;
    if (!d.valido) {
      btn.disabled = true;
      btn.title = "Número com dígito verificador inválido.";
    } else if (!alias) {
      btn.disabled = true;
      wrap.appendChild(btn);
      wrap.appendChild(el("span", "consulta-nota",
        "Consulta online indisponível para este segmento."));
      resultado.appendChild(wrap);
      return;
    }

    btn.addEventListener("click", function () { consultarOnline(d.digitos); });
    wrap.appendChild(btn);
    resultado.appendChild(wrap);
  }

  // --- consulta online --------------------------------------------------------

  async function consultarOnline(digitos) {
    var idConsulta = ++consultaSeq;
    setOnlineEstado("carregando");
    try {
      var r = await Api.consultarProcesso(digitos);
      if (idConsulta !== consultaSeq) return;
      registrarSaudeTribunal(digitos, null);
      logoutButton.hidden = false;
      if (!r.encontrado || !(r.processos || []).length) {
        setOnlineEstado("vazio", "Processo não encontrado na base pública do DataJud.");
        return;
      }
      renderOnline(r.processos, !!r._cache, r.estagio, r.processId);
    } catch (e) {
      if (idConsulta !== consultaSeq) return;
      if (e && e.message === "autenticacao_necessaria") {
        limparOnline();
        abrirLogin(digitos);
        return;
      }
      if (e && e.message === "autenticacao_sso") {
        limparOnline();
        Api.iniciarSso();
        return;
      }
      registrarSaudeTribunal(digitos, e && e.message);
      setOnlineEstado("erro", mensagemErro(e && e.message));
    }
  }

  // O resultado de cada consulta é a única medição de saúde que este navegador
  // consegue observar: a API de sondas devolve a configuração, não a medição.
  // O painel de sondas usa isso para marcar o tribunal como degradado.
  function registrarSaudeTribunal(digitos, codigo) {
    var p1 = global.P1Ui;
    if (!p1 || !p1.registrarEstadoTribunal) return;
    var alias = T.deriveAlias(digitos.slice(13, 14), digitos.slice(14, 16)).alias;
    if (alias) p1.registrarEstadoTribunal(alias, codigo);
  }

  function setOnlineEstado(estado, msg) {
    limpar(resultadoOnline);
    resultadoOnline.className = "resultado-online " + estado;

    if (estado === "carregando") {
      var status = el("div", "online-status");
      var sp = el("span", "spinner");
      sp.setAttribute("aria-hidden", "true");
      status.appendChild(sp);
      status.appendChild(doc.createTextNode("Consultando DataJud…"));
      resultadoOnline.appendChild(status);
    } else if (estado === "vazio") {
      resultadoOnline.appendChild(el("p", "online-vazio", msg));
    } else if (estado === "erro") {
      resultadoOnline.appendChild(el("p", "online-erro", msg));
    }
  }

  function limparOnline() {
    if (!resultadoOnline) return;
    consultaSeq += 1;
    resultadoOnline.className = "resultado-online vazio";
    limpar(resultadoOnline);
  }

  // Taxonomia do proxy (api/datajud.js) traduzida para o usuário. Distinguir a
  // falha do tribunal da nossa é o ponto: "não encontrado" e "tribunal fora do ar"
  // levam a decisões opostas na triagem.
  //
  // `mensagemBase` devolve null para código que não conhece: quem completa é a
  // tabela de js/p1-ui.js, com os códigos que nasceram no P1. Assim nenhuma
  // frase existe em dois lugares.
  function mensagemBase(code) {
    switch (code) {
      case "alias_desconhecido":
      case "alias_invalido":
        return "Consulta online indisponível para este segmento.";
      case "alias_inexistente":
        return "Este tribunal não tem índice público no DataJud. O processo pode existir mesmo assim.";
      case "numero_invalido":
        return "Número do processo inválido.";
      case "limite_excedido":
        return "Muitas consultas em pouco tempo. Aguarde um instante e tente de novo.";
      case "cota_excedida":
        return "A cota de consultas ao DataJud foi atingida. Tente novamente mais tarde.";
      case "tribunal_indisponivel":
        return "O tribunal está indisponível no DataJud agora. Isso não significa que o processo não exista.";
      case "origem_nao_permitida":
        return "Acesso não autorizado a partir desta origem.";
      case "credenciais_invalidas":
        return "Senha incorreta.";
      case "autenticacao_indisponivel":
        return "Login temporariamente indisponível. Tente novamente em instantes.";
      case "config_ausente":
        return "Consulta indisponível: falta configuração no servidor. Avise o time responsável.";
      case "timeout":
        return "A consulta demorou demais. Tente novamente.";
      case "xlsx_invalido":
        return "Arquivo XLSX inválido ou ilegível.";
      case "csv_invalido":
        return "Arquivo CSV inválido ou vazio.";
      case "formato_nao_suportado":
        return "Formato não suportado. Envie um arquivo CSV ou XLSX.";
      case "arquivo_maior_que_2mb":
        return "Arquivo acima de 2 MiB.";
      case "lote_vazio":
        return "Nenhum número encontrado no arquivo.";
      case "lote_maior_que_500":
        return "O limite é de 500 números por lote.";
      case "lote_invalido":
        return "Não foi possível ler os números enviados.";
      case "lote_nao_encontrado":
        return "Lote não encontrado ou expirado.";
      case "lote_indisponivel":
      case "fila_indisponivel":
        return "A triagem em lote está indisponível agora. Tente novamente em instantes.";
      case "rede_indisponivel":
      case "erro_interno":
      case "erro_servidor":
        return "Não foi possível consultar o DataJud agora. Tente novamente em instantes.";
      default:
        return null;
    }
  }

  function mensagemErro(code) {
    var p1 = global.P1Ui && global.P1Ui.mensagemP1;
    return mensagemBase(code) ||
      (p1 && p1(code)) ||
      "Não foi possível concluir a consulta.";
  }

  // --- render do resultado online --------------------------------------------

  var LIMITE_MOV = 20;

  function rotuloInstancia(p) {
    var grau = p.grau || "grau não informado";
    return p.tribunal ? grau + " — " + p.tribunal : grau;
  }

  // O mesmo número pode existir em mais de um grau. Mostrar só o primeiro hit
  // omitia silenciosamente a instância mais recente — que é a que interessa.
  // Rótulos da classificação TPU. Só códigos curados entram no mapa do
  // servidor (server/p0-core.js); tudo que não estiver lá chega aqui como
  // "nao_classificado", que é hoje o caso comum e precisa ficar explícito.
  var ROTULO_ESTAGIO = {
    expedicao_alvara: "Expedição de alvará",
    penhora: "Penhora",
    execucao: "Execução",
    nao_classificado: "Não classificado",
  };

  function rotuloEstagio(nome) {
    return ROTULO_ESTAGIO[nome] || "Não classificado";
  }

  function dataLegivel(iso) {
    var data = new Date(iso);
    return isNaN(data.getTime()) ? String(iso) : data.toLocaleDateString("pt-BR");
  }

  function blocoEstagio(estagio) {
    var bloco = el("p", "estagio");
    var classificado = estagio.estagio && estagio.estagio !== "nao_classificado";
    bloco.appendChild(el("span", "estagio-rotulo", "Estágio (TPU): "));
    bloco.appendChild(badge(rotuloEstagio(estagio.estagio), classificado ? "ok" : "warn"));
    if (!classificado) {
      bloco.appendChild(doc.createTextNode(" Nenhum movimento com código TPU curado foi encontrado."));
      return bloco;
    }
    var detalhes = ["código " + estagio.codigo];
    if (estagio.data) detalhes.push("em " + dataLegivel(estagio.data));
    if (estagio.idadeDias !== null && estagio.idadeDias !== undefined) {
      detalhes.push("há " + estagio.idadeDias + (estagio.idadeDias === 1 ? " dia" : " dias"));
    }
    bloco.appendChild(doc.createTextNode(" " + detalhes.join(", ") + "."));
    return bloco;
  }

  function renderOnline(processos, fromCache, estagio, processId) {
    limpar(resultadoOnline);
    resultadoOnline.className = "resultado-online ok";

    var titulo = el("p", "titulo-resultado", "Dados do processo (DataJud)");
    if (processos.length > 1) {
      titulo.appendChild(doc.createTextNode(" "));
      titulo.appendChild(badge(processos.length + " instâncias", "warn"));
    }
    if (fromCache) {
      titulo.appendChild(doc.createTextNode(" "));
      titulo.appendChild(badge("dados em cache", "warn"));
    }
    resultadoOnline.appendChild(titulo);
    if (estagio) resultadoOnline.appendChild(blocoEstagio(estagio));
    anexarAcaoMonitorar(processId);

    var corpo = el("div", "instancia-corpo");

    if (processos.length > 1) {
      corpo.id = "instancia-painel";
      corpo.setAttribute("role", "tabpanel");
      var abas = el("div", "instancias");
      abas.setAttribute("role", "tablist");
      abas.setAttribute("aria-label", "Instâncias encontradas");

      var botoes = processos.map(function (p, i) {
        var b = el("button", "instancia-btn", rotuloInstancia(p));
        b.type = "button";
        b.id = "instancia-tab-" + i;
        b.setAttribute("role", "tab");
        b.setAttribute("aria-controls", corpo.id);
        b.setAttribute("aria-selected", i === 0 ? "true" : "false");
        b.tabIndex = i === 0 ? 0 : -1;
        function ativar() {
          botoes.forEach(function (outro, j) {
            outro.setAttribute("aria-selected", i === j ? "true" : "false");
            outro.tabIndex = i === j ? 0 : -1;
          });
          corpo.setAttribute("aria-labelledby", b.id);
          renderInstancia(corpo, p);
        }
        b.addEventListener("click", ativar);
        b.addEventListener("keydown", function (evento) {
          var destino = i;
          if (evento.key === "ArrowRight") destino = (i + 1) % botoes.length;
          else if (evento.key === "ArrowLeft") destino = (i - 1 + botoes.length) % botoes.length;
          else if (evento.key === "Home") destino = 0;
          else if (evento.key === "End") destino = botoes.length - 1;
          else return;
          evento.preventDefault();
          botoes[destino].click();
          botoes[destino].focus();
        });
        abas.appendChild(b);
        return b;
      });

      resultadoOnline.appendChild(abas);
    }

    resultadoOnline.appendChild(corpo);
    if (processos.length > 1) corpo.setAttribute("aria-labelledby", "instancia-tab-0");
    renderInstancia(corpo, processos[0]);
  }

  // Acabou de achar o processo é o momento em que faz sentido dizer "acompanhe
  // este". O identificador vem da própria resposta, então não há nada para o
  // usuário copiar ou digitar. Sem P1Ui ou sem SSO, nada é desenhado.
  function anexarAcaoMonitorar(processId) {
    var p1 = global.P1Ui;
    if (!p1 || !p1.blocoMonitorar) return;
    var bloco = p1.blocoMonitorar(processId);
    if (bloco) resultadoOnline.appendChild(bloco);
  }

  function renderInstancia(corpo, p) {
    limpar(corpo);

    var assuntos = (p.assuntos || []).map(function (a) { return a && a.nome; })
      .filter(Boolean).join(", ");
    var classe = (p.classe && p.classe.nome) || "—";
    var orgao = (p.orgaoJulgador && p.orgaoJulgador.nome) || "—";

    var tribGrau = p.grau
      ? [(p.tribunal || "—") + " ", badge(p.grau, "warn")]
      : (p.tribunal || "—");

    corpo.appendChild(grade([
      card("Classe", classe, "Classe processual (CNJ)."),
      card("Assuntos", assuntos || "—", "Assuntos vinculados ao processo."),
      card("Órgão julgador", orgao, "Vara/órgão responsável."),
      card("Tribunal / Grau", tribGrau, "Tribunal e grau de jurisdição."),
      card("Ajuizamento", formatarData(p.dataAjuizamento), "Data de autuação registrada no tribunal."),
      card("Última atualização", formatarData(p.dataHoraUltimaAtualizacao, true), "Última movimentação enviada ao DataJud."),
    ]));

    anexarTimeline(corpo, p.movimentos || []);
  }

  function anexarTimeline(corpo, movs) {
    if (!movs.length) {
      corpo.appendChild(el("p", "online-vazio", "Sem movimentações registradas."));
      return;
    }

    corpo.appendChild(el("h3", "online-sub", "Movimentações"));

    var lista = el("ol", "timeline");
    movs.slice(0, LIMITE_MOV).forEach(function (m) { lista.appendChild(itemMov(m)); });

    var ocultos = movs.slice(LIMITE_MOV);
    var extra = null;
    if (ocultos.length) {
      extra = el("span", "mov-extra");
      extra.hidden = true;
      ocultos.forEach(function (m) { extra.appendChild(itemMov(m)); });
      lista.appendChild(extra);
    }
    corpo.appendChild(lista);

    if (ocultos.length) {
      var btn = el("button", "mostrar-mais", "Mostrar mais (" + ocultos.length + ")");
      btn.type = "button";
      btn.addEventListener("click", function () {
        extra.hidden = false;
        btn.remove();
      });
      corpo.appendChild(btn);
    }
  }

  function itemMov(m) {
    var li = doc.createElement("li");
    li.appendChild(el("span", "mov-nome", m.nome || "—"));
    li.appendChild(el("span", "data", formatarData(m.dataHora, true)));
    return li;
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

  function usarExemplo(numero) {
    input.value = numero;
    aoDigitar();
    input.focus();
  }

  function abrirLogin(digitos) {
    consultaPendente = digitos;
    focoAnterior = doc.activeElement;
    loginError.textContent = "";
    loginPassword.value = "";
    if (!loginDialog.open) loginDialog.showModal();
    loginPassword.focus();
  }

  function fecharLogin() {
    consultaPendente = null;
    if (loginDialog.open) loginDialog.close();
    if (focoAnterior && typeof focoAnterior.focus === "function") focoAnterior.focus();
  }

  async function aoEntrar(evento) {
    evento.preventDefault();
    loginError.textContent = "";
    loginSubmit.disabled = true;
    loginPassword.disabled = true;
    loginForm.setAttribute("aria-busy", "true");
    loginSubmit.textContent = "Entrando…";
    try {
      await Api.entrar(loginPassword.value);
      var pendente = consultaPendente;
      if (loginDialog.open) loginDialog.close();
      logoutButton.hidden = false;
      loginPassword.value = "";
      consultaPendente = null;
      if (pendente) await consultarOnline(pendente);
    } catch (e) {
      loginError.textContent = mensagemErro(e && e.message);
    } finally {
      loginSubmit.disabled = false;
      loginPassword.disabled = false;
      loginForm.removeAttribute("aria-busy");
      loginSubmit.textContent = "Entrar";
      if (loginDialog.open && loginError.textContent) loginPassword.focus();
    }
  }

  async function sair() {
    logoutButton.disabled = true;
    try {
      await Api.sair();
      limparOnline();
      logoutButton.hidden = true;
      input.focus();
    } catch (e) {
      setOnlineEstado("erro", mensagemErro(e && e.message));
    } finally {
      logoutButton.disabled = false;
    }
  }

  function numerosDoLote(valor) {
    return String(valor || "").split(/[\r\n;,]+/).map(function (numero) { return numero.trim(); }).filter(Boolean);
  }

  function textoProgresso(lote) {
    var contagens = lote.contagens || {};
    var finalizados = (contagens.concluido || 0) + (contagens.invalido || 0) + (contagens.duplicado || 0) + (contagens.falhou || 0);
    return finalizados + "/" + lote.total + " linhas finalizadas" + (contagens.falhou ? "; " + contagens.falhou + " falharam." : ".");
  }

  var ROTULO_STATUS_ITEM = {
    pendente: "Na fila",
    processando: "Consultando",
    concluido: "Concluído",
    invalido: "Número inválido",
    duplicado: "Duplicado",
    falhou: "Falhou",
  };

  // Tabela montada com createElement/textContent: nada de innerHTML, já que
  // numero e erro vêm de dados externos. Ver tests/node/ui-security.test.js.
  function renderItensLote(itens) {
    limpar(batchItens);
    if (!itens || !itens.length) {
      batchItens.hidden = true;
      return;
    }
    var tabela = el("table", "tabela-lote");
    var cabecalho = el("tr");
    ["Linha", "Número", "Situação", "Estágio (TPU)"].forEach(function (texto) {
      var th = el("th", null, texto);
      th.scope = "col";
      cabecalho.appendChild(th);
    });
    tabela.appendChild(el("thead")).appendChild(cabecalho);

    var corpo = el("tbody");
    itens.forEach(function (item) {
      var linha = el("tr");
      linha.appendChild(el("td", null, item.linha));
      linha.appendChild(el("td", "numero-lote", item.numero));
      var situacao = ROTULO_STATUS_ITEM[item.status] || item.status;
      linha.appendChild(el("td", null, item.erro ? situacao + " — " + item.erro : situacao));
      linha.appendChild(el("td", null, item.status === "concluido" ? rotuloEstagio(item.estagio) : "—"));
      corpo.appendChild(linha);
    });
    tabela.appendChild(corpo);
    batchItens.appendChild(tabela);
    batchItens.hidden = false;
  }

  async function atualizarLote(id) {
    try {
      var lote = await Api.consultarLote(id);
      batchStatus.textContent = textoProgresso(lote);
      renderItensLote(lote.itens);
      if (!["pendente", "processando"].includes(lote.status) && batchTimer) {
        global.clearInterval(batchTimer);
        batchTimer = null;
      }
      if (!["pendente", "processando"].includes(lote.status)) {
        batchExport.href = "/api/batches/export?id=" + encodeURIComponent(id);
        batchExport.hidden = false;
        batchExportXlsx.href = batchExport.href + "&formato=xlsx";
        batchExportXlsx.hidden = false;
      }
    } catch (e) {
      batchStatus.textContent = mensagemErro(e && e.message);
      if (batchTimer) { global.clearInterval(batchTimer); batchTimer = null; }
    }
  }

  async function enviarLote(evento) {
    evento.preventDefault();
    batchStatus.textContent = "";
    batchSubmit.disabled = true;
    limpar(batchItens);
    batchItens.hidden = true;
    batchExport.hidden = true;
    batchExportXlsx.hidden = true;
    try {
      var lote = await Api.criarLote(numerosDoLote(batchNumbers.value));
      await acompanharNovoLote(lote);
    } catch (e) {
      if (e && e.message === "autenticacao_sso") Api.iniciarSso();
      else batchStatus.textContent = mensagemErro(e && e.message);
    } finally {
      batchSubmit.disabled = false;
    }
  }

  async function acompanharNovoLote(lote) {
    batchStatus.textContent = "Lote recebido. Preparando fila…";
    await atualizarLote(lote.id);
    if (!batchTimer) batchTimer = global.setInterval(function () { atualizarLote(lote.id); }, 3000);
  }

  async function importarArquivoLote() {
    var arquivo = batchFile.files && batchFile.files[0];
    if (!arquivo) return;
    batchStatus.textContent = "";
    limpar(batchItens);
    batchItens.hidden = true;
    batchExport.hidden = true;
    batchExportXlsx.hidden = true;
    try {
      var xlsx = /\.xlsx$/i.test(arquivo.name || "");
      await acompanharNovoLote(xlsx ? await Api.importarXlsx(arquivo) : await Api.importarCsv(arquivo));
    } catch (e) {
      if (e && e.message === "autenticacao_sso") Api.iniciarSso();
      else batchStatus.textContent = mensagemErro(e && e.message);
    } finally {
      batchFile.value = "";
    }
  }

  function init() {
    input = doc.getElementById("cnj-input");
    resultado = doc.getElementById("resultado");
    resultadoOnline = doc.getElementById("resultado-online");
    contador = doc.getElementById("contador");
    loginDialog = doc.getElementById("login-dialog");
    loginForm = doc.getElementById("login-form");
    loginPassword = doc.getElementById("login-password");
    loginError = doc.getElementById("login-error");
    loginSubmit = doc.getElementById("login-submit");
    logoutButton = doc.getElementById("session-logout");
    batchForm = doc.getElementById("batch-form");
    batchNumbers = doc.getElementById("batch-numbers");
    batchFile = doc.getElementById("batch-file");
    batchSubmit = doc.getElementById("batch-submit");
    batchStatus = doc.getElementById("batch-status");
    batchItens = doc.getElementById("batch-itens");
    batchExport = doc.getElementById("batch-export");
    batchExportXlsx = doc.getElementById("batch-export-xlsx");

    input.addEventListener("input", aoDigitar);
    loginForm.addEventListener("submit", aoEntrar);
    doc.getElementById("login-cancel").addEventListener("click", fecharLogin);
    loginDialog.addEventListener("cancel", function () { consultaPendente = null; });
    loginDialog.addEventListener("close", function () {
      if (focoAnterior && typeof focoAnterior.focus === "function") focoAnterior.focus();
    });
    logoutButton.addEventListener("click", sair);
    batchForm.addEventListener("submit", enviarLote);
    batchFile.addEventListener("change", importarArquivoLote);
    // A decodificação offline é pública: um visitante sem sessão não pode ser
    // empurrado para o Entra só por abrir a página. O redirecionamento acontece
    // apenas nas ações que exigem identidade (consulta online, lote, import).
    Api.verificarSessao().then(function () {
      logoutButton.hidden = false;
    }).catch(function () {
      logoutButton.hidden = true;
    });

    var exemplos = doc.querySelectorAll("[data-exemplo]");
    Array.prototype.forEach.call(exemplos, function (btn) {
      btn.addEventListener("click", function () {
        usarExemplo(btn.getAttribute("data-exemplo"));
      });
    });

    aoDigitar(); // estado inicial
  }

  // Único ponto de contato com js/p1-ui.js: a tabela de mensagens herdadas.
  global.CNJApp = { mensagemBase: mensagemBase };

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
