// Interface P2: tokens de serviço da API interna e trilha de auditoria do
// próprio usuário.
// Script clássico. Depende de window.P2Api, window.P1Ui e window.CNJApi.
//
// Ficou fora de js/p1-ui.js de propósito: aquele arquivo já concentra glossário,
// carteiras, membros, sondas e histórico. Cada camada tem a própria tabela de
// mensagens e consulta a das outras quando não conhece o código — mesma
// convenção de MENSAGENS_P1 sobre mensagemBase de js/app.js.
//
// Regra de segurança desta camada, a mesma de js/app.js e js/p1-ui.js: nada
// vindo da rede é concatenado em HTML. innerHTML não é usado neste arquivo.
(function (global) {
  "use strict";
  var doc = global.document;

  // Resolvidos na hora do uso: a ordem dos <script> não pode virar acoplamento.
  function api() { return global.P2Api; }
  function p1() { return global.P1Ui; }
  function sessao() { return global.CNJApi; }

  var PAGINA_TRILHA = 25;

  var MENSAGENS_P2 = {
    nome_invalido: "Dê um nome ao token para identificá-lo depois.",
    limite_invalido: "O limite diário precisa ser um número inteiro entre 1 e 10000.",
    token_invalido: "Token inválido ou já removido.",
    token_nao_encontrado: "Este token não existe ou não foi emitido por você.",
    token_indisponivel: "Os tokens de serviço estão indisponíveis agora. Tente novamente em instantes.",
    auditoria_indisponivel: "A trilha de auditoria está indisponível agora. Tente novamente em instantes.",
  };

  // Rótulos das ações registradas na trilha. Código desconhecido aparece como
  // veio: inventar tradução esconderia um evento novo em vez de mostrá-lo.
  var ROTULO_ACAO = {
    consulta_unitaria: "Consulta de processo",
    consulta_lote: "Consulta em lote",
    consulta_automacao: "Consulta automática",
    historico_processo: "Leitura de histórico",
    lote_exportado: "Exportação de lote",
    membro_concedido: "Membro incluído na carteira",
    membro_removido: "Membro removido da carteira",
    portfolio_membros: "Administração de membros",
    service_token_emitido: "Token emitido",
    service_token_revogado: "Token revogado",
    api_v1: "Chamada da API interna",
    expurgo_retencao: "Expurgo de retenção",
  };

  var estado = { tokens: [], offset: 0, total: 0 };

  var tokensStatus, tokensForm, tokenNome, tokenLimite, tokensLista, tokenEmitido;
  var trilhaStatus, trilhaLista, trilhaAnterior, trilhaProxima, trilhaAtualizar;

  // --- helpers de DOM ---------------------------------------------------------

  function el(tag, className, texto) {
    var n = doc.createElement(tag);
    if (className) n.className = className;
    if (texto != null) n.textContent = String(texto);
    return n;
  }

  function limpar(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function botao(className, texto) {
    var b = el("button", className, texto);
    b.type = "button";
    b.setAttribute("type", "button");
    return b;
  }

  function tabela(colunas) {
    var t = el("table", "p1-tabela");
    var linha = el("tr");
    colunas.forEach(function (texto) {
      var th = el("th", null, texto);
      th.scope = "col";
      th.setAttribute("scope", "col");
      linha.appendChild(th);
    });
    t.appendChild(el("thead")).appendChild(linha);
    t.appendChild(el("tbody"));
    return t;
  }

  function celula(linha, valor, className) {
    var td = el("td", className || null);
    if (valor != null && valor.nodeType) td.appendChild(valor);
    else td.textContent = String(valor == null ? "" : valor);
    linha.appendChild(td);
    return td;
  }

  function envolverTabela(t) {
    var wrap = el("div", "p1-tabela-wrap");
    wrap.appendChild(t);
    return wrap;
  }

  function dataLegivel(valor) {
    if (!valor) return "—";
    var data = new Date(valor);
    if (isNaN(data.getTime())) return String(valor);
    function p2(n) { return String(n).padStart(2, "0"); }
    return p2(data.getDate()) + "/" + p2(data.getMonth() + 1) + "/" + data.getFullYear() +
      " " + p2(data.getHours()) + ":" + p2(data.getMinutes());
  }

  // --- mensagens --------------------------------------------------------------

  function mensagemP2(codigo) {
    return Object.prototype.hasOwnProperty.call(MENSAGENS_P2, String(codigo))
      ? MENSAGENS_P2[String(codigo)]
      : null;
  }

  function mensagemErro(codigo) {
    var herdada = p1() && p1().mensagemErro;
    return mensagemP2(codigo) ||
      (herdada && herdada(codigo)) ||
      "Não foi possível concluir a operação.";
  }

  function definirStatus(alvo, texto) {
    if (!alvo) return;
    alvo.textContent = texto == null ? "" : String(texto);
  }

  function blocoEntrar(alvo, mensagem) {
    limpar(alvo);
    alvo.appendChild(doc.createTextNode(mensagem + " "));
    var b = botao("p1-entrar", "Entrar");
    b.addEventListener("click", function () {
      var s = sessao();
      if (s && s.iniciarSso) s.iniciarSso();
    });
    alvo.appendChild(b);
  }

  // `redirecionar` separa ação do usuário (vai para o Entra) de carga inicial da
  // página: abrir a ferramenta nunca pode empurrar ninguém para o login.
  function tratarFalha(erro, alvo, redirecionar) {
    var codigo = (erro && erro.message) || "erro_servidor";
    if (codigo === "autenticacao_sso" || codigo === "autenticacao_necessaria") {
      if (redirecionar) {
        var s = sessao();
        if (s && s.iniciarSso) s.iniciarSso();
        return;
      }
      blocoEntrar(alvo, "Sua sessão não está ativa.");
      return;
    }
    definirStatus(alvo, mensagemErro(codigo));
  }

  // --- tokens de serviço ------------------------------------------------------

  function renderTokens() {
    limpar(tokensLista);
    if (!estado.tokens.length) {
      tokensLista.appendChild(el("p", "p1-vazio", "Nenhum token emitido."));
      return;
    }

    var t = tabela(["Nome", "Prefixo", "Limite/dia", "Emitido em", "Último uso", "Situação", ""]);
    var corpo = t.children[1];
    estado.tokens.forEach(function (token) {
      var linha = el("tr");
      celula(linha, token.nome);
      celula(linha, token.prefixo, "p1-mono");
      celula(linha, token.limiteDia);
      celula(linha, dataLegivel(token.criadoEm));
      celula(linha, dataLegivel(token.ultimoUsoEm));
      celula(linha, token.revogadoEm ? "Revogado em " + dataLegivel(token.revogadoEm) : "Ativo");

      var acoes = el("td");
      if (!token.revogadoEm) {
        var revogar = botao("btn-secundario", "Revogar");
        revogar.addEventListener("click", function () { return revogarToken(token); });
        acoes.appendChild(revogar);
      }
      linha.appendChild(acoes);
      corpo.appendChild(linha);
    });
    tokensLista.appendChild(envolverTabela(t));
  }

  // O valor em claro aparece uma única vez. O banco guarda só o hash: quem
  // fechar esta tela sem copiar precisa emitir outro token.
  function mostrarTokenEmitido(token) {
    limpar(tokenEmitido);
    tokenEmitido.hidden = false;
    tokenEmitido.appendChild(el("p", "p2-token-aviso",
      "Copie o token agora. Ele não será exibido de novo — o servidor guarda apenas o hash."));
    var valor = el("code", "p2-token-valor", token.token);
    valor.tabIndex = 0;
    tokenEmitido.appendChild(valor);
    tokenEmitido.appendChild(el("p", "p2-token-uso",
      "Use no header Authorization: Bearer, em POST /api/v1/decodificar e POST /api/v1/processos."));
  }

  async function carregarTokens(redirecionar) {
    try {
      var retorno = await api().listarTokens();
      estado.tokens = retorno.tokens || [];
      if (tokensForm) tokensForm.hidden = false;
      definirStatus(tokensStatus, estado.tokens.length
        ? estado.tokens.length + " token(s) emitido(s) por você."
        : "Você ainda não emitiu tokens de serviço.");
      renderTokens();
    } catch (erro) {
      estado.tokens = [];
      renderTokens();
      // Sessão caiu no meio do uso: esconder o formulário evita oferecer uma
      // emissão que vai falhar de novo.
      if (tokensForm) tokensForm.hidden = true;
      tratarFalha(erro, tokensStatus, redirecionar);
    }
  }

  async function emitirToken(evento) {
    evento.preventDefault();
    var nome = String(tokenNome.value || "").trim();
    if (!nome) {
      definirStatus(tokensStatus, mensagemErro("nome_invalido"));
      return;
    }
    var limite = String(tokenLimite.value || "").trim();
    try {
      var criado = await api().emitirToken(nome, limite === "" ? null : Number(limite));
      tokenNome.value = "";
      tokenLimite.value = "";
      mostrarTokenEmitido(criado);
      definirStatus(tokensStatus, "Token emitido.");
      await carregarTokens(true);
    } catch (erro) {
      tratarFalha(erro, tokensStatus, true);
    }
  }

  async function revogarToken(token) {
    try {
      await api().revogarToken(token.id);
      definirStatus(tokensStatus, "Token revogado.");
      await carregarTokens(true);
    } catch (erro) {
      tratarFalha(erro, tokensStatus, true);
    }
  }

  // --- trilha de auditoria ----------------------------------------------------

  function rotuloAcao(acao) {
    return ROTULO_ACAO[String(acao)] || String(acao || "—");
  }

  function renderTrilha(eventos) {
    limpar(trilhaLista);
    if (!eventos.length) {
      trilhaLista.appendChild(el("p", "p1-vazio", "Nenhum evento registrado para você."));
      return;
    }

    var t = tabela(["Quando", "Ação", "Resultado", "Recurso", "Ator"]);
    var corpo = t.children[1];
    eventos.forEach(function (evento) {
      var linha = el("tr");
      celula(linha, dataLegivel(evento.createdAt));
      celula(linha, rotuloAcao(evento.acao));
      celula(linha, evento.resultado);
      celula(linha, evento.recurso || "—");
      celula(linha, evento.ator, "p1-mono");
      corpo.appendChild(linha);
    });
    trilhaLista.appendChild(envolverTabela(t));
  }

  function atualizarPaginacao() {
    if (trilhaAnterior) trilhaAnterior.disabled = estado.offset <= 0;
    if (trilhaProxima) trilhaProxima.disabled = estado.offset + PAGINA_TRILHA >= estado.total;
  }

  async function carregarTrilha(redirecionar) {
    try {
      var retorno = await api().listarAuditoria({ limite: PAGINA_TRILHA, offset: estado.offset });
      estado.total = retorno.total || 0;
      definirStatus(trilhaStatus, estado.total
        ? "Mostrando " + Math.min(estado.offset + PAGINA_TRILHA, estado.total) + " de " + estado.total + " evento(s)."
        : "Nenhum evento registrado para você.");
      renderTrilha(retorno.eventos || []);
      atualizarPaginacao();
    } catch (erro) {
      renderTrilha([]);
      tratarFalha(erro, trilhaStatus, redirecionar);
    }
  }

  function paginar(delta) {
    var proximo = estado.offset + delta * PAGINA_TRILHA;
    estado.offset = Math.max(0, proximo);
    return carregarTrilha(true);
  }

  // --- inicialização ----------------------------------------------------------

  function init() {
    tokensStatus = doc.getElementById("tokens-status");
    tokensForm = doc.getElementById("token-form");
    tokenNome = doc.getElementById("token-nome");
    tokenLimite = doc.getElementById("token-limite");
    tokensLista = doc.getElementById("tokens-lista");
    tokenEmitido = doc.getElementById("token-emitido");
    trilhaStatus = doc.getElementById("trilha-status");
    trilhaLista = doc.getElementById("trilha-lista");
    trilhaAnterior = doc.getElementById("trilha-anterior");
    trilhaProxima = doc.getElementById("trilha-proxima");
    trilhaAtualizar = doc.getElementById("trilha-atualizar");

    if (tokensForm && tokenNome) tokensForm.addEventListener("submit", emitirToken);
    if (trilhaAnterior) trilhaAnterior.addEventListener("click", function () { return paginar(-1); });
    if (trilhaProxima) trilhaProxima.addEventListener("click", function () { return paginar(1); });
    if (trilhaAtualizar) trilhaAtualizar.addEventListener("click", function () { estado.offset = 0; return carregarTrilha(true); });

    // Carga inicial sem redirecionar: quem abre a página sem sessão vê um botão
    // "Entrar", não um salto para o Entra.
    if (tokensLista && api()) carregarTokens(false);
    if (trilhaLista && api()) carregarTrilha(false);
  }

  global.P2Ui = {
    mensagemP2: mensagemP2,
    mensagemErro: mensagemErro,
    rotuloAcao: rotuloAcao,
    recarregarTokens: function () { return carregarTokens(false); },
    recarregarTrilha: function () { return carregarTrilha(false); },
  };

  if (doc) {
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init);
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
