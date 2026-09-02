// Interface de consolidação P1: glossário TPU, correções candidatas, carteiras
// monitoradas, membros, sondas de saúde e histórico do processo.
// Script clássico. Depende de window.P1Api, window.CNJ e window.CNJApi.
//
// Regra de segurança desta camada, a mesma de js/app.js: nada vindo da rede é
// concatenado em HTML. Nome de carteira, e-mail de membro e número de processo
// entram por textContent/createTextNode, em nós criados aqui.
// innerHTML não é usado em lugar nenhum deste arquivo.
(function (global) {
  "use strict";
  var doc = global.document;

  // Resolvidos na hora do uso: a ordem dos <script> não pode virar acoplamento.
  function api() { return global.P1Api; }
  function cnj() { return global.CNJ; }
  function sessao() { return global.CNJApi; }

  var LIMITE_SUGESTOES = 8;
  var INTERVALO_PADRAO_MINUTOS = 1440;
  var MAX_INTERVALO_MINUTOS = 1440;
  var VERSAO_TPU = "tpu-2026-04-09-semente-1";

  // Espelho cliente do catálogo curado de server/tpu-catalog.js. A duplicação é
  // deliberada e segue o precedente de js/tables.js sobre server/cnj-validation.js:
  // é uma tabela legal pública e minúscula, e uma busca por texto não justifica
  // ida ao servidor. Estágio jurídico continua vindo só de código TPU versionado
  // — nunca do nome do movimento.
  var GLOSSARIO_TPU = [
    { codigo: 12548, descricao: "Expedição de alvará", estagio: "expedicao_alvara", versao: VERSAO_TPU },
  ];

  var MENSAGENS_P1 = {
    portfolio_invalido: "Dê um nome à carteira para poder salvá-la.",
    portfolio_nao_encontrado: "Você não tem acesso a esta carteira, ou ela já foi removida. Só quem criou a carteira pode alterá-la.",
    portfolio_indisponivel: "As carteiras estão indisponíveis agora. Tente novamente em instantes.",
    item_invalido: "Informe um processo já consultado e um intervalo entre 1 e 1440 minutos.",
    membro_invalido: "Informe um e-mail válido para convidar o membro.",
    probe_invalido: "Informe um número de processo válido e um intervalo entre 1 e 1440 minutos.",
    probe_indisponivel: "As sondas de saúde estão indisponíveis agora. Tente novamente em instantes.",
    processo_nao_encontrado: "Este processo não está em nenhuma carteira que você acompanha. Peça ao criador da carteira para incluí-lo.",
    historico_indisponivel: "O histórico está indisponível agora. Tente novamente em instantes.",
    autenticacao_necessaria: "Entre com sua conta para usar esta área.",
    metodo_nao_permitido: "Esta operação não está disponível nesta tela.",
    orcamento_excedido: "O orçamento diário de consultas ao DataJud acabou. O monitoramento recomeça amanhã.",
    circuito_aberto: "As consultas a este tribunal estão suspensas depois de falhas seguidas. Tente de novo mais tarde.",
  };

  // Espelho de classificarFalhaTribunal() em server/p1-automation.js, mais o
  // circuito aberto, que lá é medição própria. Só código de falha de tribunal
  // entra: um erro de digitação não pode virar "tribunal fora do ar".
  var ESTADO_TRIBUNAL = {
    cota_excedida: { estado: "degradado", rotulo: "Degradado", tipo: "warn" },
    timeout: { estado: "degradado", rotulo: "Degradado", tipo: "warn" },
    tribunal_indisponivel: { estado: "indisponivel", rotulo: "Indisponível", tipo: "erro" },
    alias_inexistente: { estado: "indisponivel", rotulo: "Indisponível", tipo: "erro" },
    rede_indisponivel: { estado: "indisponivel", rotulo: "Indisponível", tipo: "erro" },
    circuito_aberto: { estado: "circuito", rotulo: "Circuito aberto", tipo: "erro" },
  };
  var TRIBUNAL_DISPONIVEL = { estado: "disponivel", rotulo: "Disponível", tipo: "ok" };

  var ROTULO_SUGESTAO = {
    um_digito: "um dígito diferente",
    transposicao_adjacente: "dois dígitos trocados",
  };

  var estado = {
    portfolios: [],
    selecionado: null,
    itens: [],
    membros: [],
    probes: [],
    saudePorAlias: {},
  };

  var glossarioBusca, glossarioResultado;
  var portfoliosStatus, portfolioForm, portfolioNome, portfoliosLista, portfolioDetalhe;
  var historicoForm, historicoNumero, historicoStatus, historicoResultado;
  var sequenciaId = 0;

  // Células da coluna "Sinal nesta sessão" desenhadas agora, uma por sonda.
  // Guardá-las permite trocar só o sinal quando uma consulta observa o tribunal,
  // em vez de redesenhar o painel inteiro por cima do que o criador está
  // digitando num formulário. Recriada a cada render do detalhe.
  var celulasSinal = [];

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
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

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

  function proximoId(prefixo) {
    sequenciaId += 1;
    return prefixo + "-" + sequenciaId;
  }

  function campo(pai, rotulo, tipo, atributos) {
    var id = proximoId("p1-campo");
    var etiqueta = el("label", "p1-rotulo", rotulo);
    etiqueta.setAttribute("for", id);
    var entrada = el("input");
    entrada.id = id;
    entrada.type = tipo;
    entrada.setAttribute("id", id);
    entrada.setAttribute("type", tipo);
    for (var chave in (atributos || {})) {
      if (Object.prototype.hasOwnProperty.call(atributos, chave)) {
        entrada.setAttribute(chave, atributos[chave]);
      }
    }
    pai.appendChild(etiqueta);
    pai.appendChild(entrada);
    return entrada;
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

  function corpoDaTabela(t) {
    return t.children[1];
  }

  // A tabela rola dentro do próprio bloco: uma carteira grande não pode
  // empurrar a largura da página. Mesma solução de .batch-itens.
  function envolverTabela(t) {
    var wrap = el("div", "p1-tabela-wrap");
    wrap.appendChild(t);
    return wrap;
  }

  function celula(linha, valor, className) {
    var td = el("td", className || null);
    anexar(td, valor);
    linha.appendChild(td);
    return td;
  }

  function dataLegivel(valor) {
    if (!valor) return "—";
    var data = new Date(valor);
    if (isNaN(data.getTime())) return String(valor);
    function p2(n) { return String(n).padStart(2, "0"); }
    return p2(data.getDate()) + "/" + p2(data.getMonth() + 1) + "/" + data.getFullYear() +
      " " + p2(data.getHours()) + ":" + p2(data.getMinutes());
  }

  function numeroLegivel(digitos) {
    var c = cnj();
    return c && c.format ? c.format(digitos) : String(digitos || "");
  }

  // --- mensagens --------------------------------------------------------------

  // Tabela só dos códigos que nasceram no P1. Os herdados (numero_invalido,
  // origem_nao_permitida, alias_*) continuam morando em js/app.js — nada é
  // duplicado; cada lado consulta a tabela do outro quando não conhece o código.
  function mensagemP1(codigo) {
    return Object.prototype.hasOwnProperty.call(MENSAGENS_P1, String(codigo))
      ? MENSAGENS_P1[String(codigo)]
      : null;
  }

  function mensagemErro(codigo) {
    var base = global.CNJApp && global.CNJApp.mensagemBase;
    return mensagemP1(codigo) ||
      (base && base(codigo)) ||
      "Não foi possível concluir a operação.";
  }

  // --- saúde do tribunal ------------------------------------------------------

  function classificarTribunal(codigo) {
    if (!codigo) return TRIBUNAL_DISPONIVEL;
    return ESTADO_TRIBUNAL[String(codigo)] || TRIBUNAL_DISPONIVEL;
  }

  // Só o que o próprio navegador observou nesta sessão vira sinal: a API de
  // sondas devolve a configuração, não a medição. Códigos que não falam do
  // tribunal são ignorados de propósito.
  function registrarEstadoTribunal(alias, codigo) {
    if (!alias) return;
    if (codigo && !ESTADO_TRIBUNAL[String(codigo)]) return;
    estado.saudePorAlias[String(alias)] = { codigo: codigo || null };
    atualizarCelulasSinal(String(alias));
  }

  // Troca só o conteúdo da célula do sinal. Redesenhar o detalhe inteiro aqui
  // destruiria os formulários abertos junto com o que o criador tivesse
  // digitado neles — e uma consulta online pode acontecer a qualquer momento.
  function atualizarCelulasSinal(alias) {
    celulasSinal.forEach(function (registro) {
      if (String(registro.alias) !== alias) return;
      limpar(registro.celula);
      registro.celula.appendChild(sinalDoTribunal(alias));
    });
  }

  function estadoTribunal(alias) {
    var registro = estado.saudePorAlias[String(alias)];
    return registro ? registro.codigo : null;
  }

  function sinalDoTribunal(alias) {
    var registro = estado.saudePorAlias[String(alias)];
    var span = el("span", "p1-sinal-tribunal");
    if (!registro) {
      span.appendChild(doc.createTextNode("sem sinal nesta sessão"));
      return span;
    }
    var classificacao = classificarTribunal(registro.codigo);
    span.appendChild(badge(classificacao.rotulo, classificacao.tipo));
    return span;
  }

  // --- glossário TPU ----------------------------------------------------------

  function buscarGlossario(termo) {
    var alvo = String(termo == null ? "" : termo).trim().toLowerCase();
    if (!alvo) return GLOSSARIO_TPU.slice();
    return GLOSSARIO_TPU.filter(function (movimento) {
      return String(movimento.codigo).indexOf(alvo) >= 0 ||
        movimento.descricao.toLowerCase().indexOf(alvo) >= 0;
    });
  }

  function rotuloEstagio(estagio) {
    if (!estagio || estagio === "nao_classificado") return "Não classificado";
    for (var i = 0; i < GLOSSARIO_TPU.length; i += 1) {
      if (GLOSSARIO_TPU[i].estagio === estagio) return GLOSSARIO_TPU[i].descricao;
    }
    return "Estágio fora do catálogo local";
  }

  function renderGlossario() {
    if (!glossarioResultado) return;
    limpar(glossarioResultado);
    var achados = buscarGlossario(glossarioBusca ? glossarioBusca.value : "");
    if (!achados.length) {
      glossarioResultado.appendChild(el("p", "p1-vazio",
        "Nenhum movimento curado corresponde a essa busca."));
      return;
    }
    var lista = el("ul", "glossario-lista");
    achados.forEach(function (movimento) {
      var item = el("li");
      item.appendChild(el("span", "glossario-codigo", movimento.codigo));
      item.appendChild(el("span", "glossario-descricao", movimento.descricao));
      item.appendChild(el("span", "glossario-versao", movimento.versao));
      lista.appendChild(item);
    });
    glossarioResultado.appendChild(lista);
  }

  // --- correções candidatas ---------------------------------------------------

  // Devolve um bloco de candidatos ou null. Nada é aplicado sozinho: quem troca
  // o valor do campo é o clique do usuário, via `aoEscolher`.
  function blocoSugestoes(bruto, aoEscolher) {
    var c = cnj();
    if (!c || !c.sugerirCorrecoes) return null;
    var candidatos = c.sugerirCorrecoes(bruto);
    if (!candidatos.length) return null;

    var bloco = el("div", "sugestoes");
    bloco.appendChild(el("p", "sugestoes-titulo",
      "Este número não passa no dígito verificador. Números próximos que passam:"));
    candidatos.slice(0, LIMITE_SUGESTOES).forEach(function (candidato) {
      var b = botao("sugestao", numeroLegivel(candidato.numero) +
        " · " + (ROTULO_SUGESTAO[candidato.tipo] || candidato.tipo));
      b.addEventListener("click", function () { aoEscolher(candidato.numero); });
      bloco.appendChild(b);
    });
    bloco.appendChild(el("p", "sugestoes-nota",
      "Nenhuma correção é aplicada automaticamente — escolha uma se for o caso."));
    return bloco;
  }

  // Liga um campo de número CNJ a um contêiner de candidatos logo abaixo dele.
  function ligarSugestoes(entrada, destino) {
    if (!entrada || !destino) return;
    entrada.addEventListener("input", function () {
      limpar(destino);
      var c = cnj();
      if (!c) return;
      var digitos = c.normalize(entrada.value);
      if (digitos.length !== 20) return;
      var bloco = blocoSugestoes(digitos, function (numero) {
        entrada.value = c.format(numero);
        limpar(destino);
      });
      if (bloco) destino.appendChild(bloco);
    });
  }

  // --- status e falhas --------------------------------------------------------

  function definirStatus(alvo, valor) {
    if (!alvo) return;
    limpar(alvo);
    anexar(alvo, valor);
  }

  function blocoEntrar(mensagem) {
    var wrap = el("span", "p1-status-entrar");
    wrap.appendChild(doc.createTextNode(mensagem + " "));
    var b = botao("p1-entrar", "Entrar");
    b.addEventListener("click", function () {
      var s = sessao();
      if (s && s.iniciarSso) s.iniciarSso();
    });
    wrap.appendChild(b);
    return wrap;
  }

  // `redirecionar` separa ação do usuário (vai para o Entra, como no lote e na
  // consulta unitária) de carga inicial da página (o decodificador é público:
  // abrir a ferramenta nunca pode empurrar ninguém para o login).
  function tratarFalha(erro, alvo, redirecionar) {
    var codigo = (erro && erro.message) || "erro_servidor";
    if (codigo === "autenticacao_sso" || codigo === "autenticacao_necessaria") {
      if (redirecionar) {
        var s = sessao();
        if (s && s.iniciarSso) s.iniciarSso();
        return;
      }
      definirStatus(alvo, blocoEntrar("Sua sessão não está ativa."));
      return;
    }
    definirStatus(alvo, mensagemErro(codigo));
  }

  // --- carteiras --------------------------------------------------------------

  async function carregarPortfolios(redirecionar) {
    try {
      var retorno = await api().listarPortfolios();
      estado.portfolios = retorno.portfolios || [];
      if (portfolioForm) portfolioForm.hidden = false;
      definirStatus(portfoliosStatus, estado.portfolios.length
        ? ""
        : "Nenhuma carteira ainda. Crie a primeira abaixo.");
      renderListaPortfolios();
    } catch (erro) {
      tratarFalha(erro, portfoliosStatus, redirecionar);
    }
  }

  function renderListaPortfolios() {
    if (!portfoliosLista) return;
    limpar(portfoliosLista);
    estado.portfolios.forEach(function (portfolio) {
      var b = botao("p1-portfolio-btn", portfolio.nome);
      b.setAttribute("aria-pressed", estado.selecionado && estado.selecionado.id === portfolio.id ? "true" : "false");
      b.addEventListener("click", function () { return selecionarPortfolio(portfolio); });
      portfoliosLista.appendChild(b);
    });
  }

  // A carteira só vira a selecionada depois que as três listas chegam. Trocar
  // antes deixaria o painel com o título de uma carteira, as linhas de outra e
  // botões mirando ids que não são daquela carteira — o servidor recusa, mas o
  // usuário vê "sem acesso" numa carteira que é dele.
  async function selecionarPortfolio(portfolio) {
    definirStatus(portfoliosStatus, "Carregando carteira…");
    var itens, membros, probes;
    try {
      itens = await api().listarItens(portfolio.id);
      membros = await api().listarMembros(portfolio.id);
      probes = await api().listarProbes(portfolio.id);
    } catch (erro) {
      if (!estado.selecionado || estado.selecionado.id !== portfolio.id) descartarDetalhe();
      tratarFalha(erro, portfoliosStatus, true);
      return;
    }
    estado.selecionado = portfolio;
    estado.itens = itens.itens || [];
    estado.membros = membros.membros || [];
    estado.probes = probes.probes || [];
    definirStatus(portfoliosStatus, "");
    renderListaPortfolios();
    renderDetalhe();
  }

  function descartarDetalhe() {
    estado.selecionado = null;
    estado.itens = [];
    estado.membros = [];
    estado.probes = [];
    renderListaPortfolios();
    renderDetalhe();
  }

  async function recarregarSelecionado() {
    if (estado.selecionado) await selecionarPortfolio(estado.selecionado);
  }

  function ehCriador() {
    return Boolean(estado.selecionado && estado.selecionado.papel === "criador");
  }

  function renderDetalhe() {
    if (!portfolioDetalhe) return;
    limpar(portfolioDetalhe);
    celulasSinal = [];
    if (!estado.selecionado) {
      portfolioDetalhe.hidden = true;
      return;
    }
    portfolioDetalhe.hidden = false;

    var titulo = el("h3", "p1-detalhe-titulo", estado.selecionado.nome);
    titulo.appendChild(doc.createTextNode(" "));
    titulo.appendChild(badge(ehCriador() ? "criador" : "somente leitura", ehCriador() ? "ok" : "warn"));
    portfolioDetalhe.appendChild(titulo);

    if (!ehCriador()) {
      portfolioDetalhe.appendChild(el("p", "p1-aviso",
        "Você participa desta carteira como membro: somente o criador pode alterar processos, membros e sondas. Você continua recebendo o resumo diário."));
    } else {
      portfolioDetalhe.appendChild(secaoRenomear());
    }

    portfolioDetalhe.appendChild(secaoItens());
    portfolioDetalhe.appendChild(secaoMembros());
    portfolioDetalhe.appendChild(secaoProbes());
  }

  function secao(titulo, descricao) {
    var bloco = el("div", "p1-bloco");
    bloco.appendChild(el("h4", "p1-bloco-titulo", titulo));
    if (descricao) bloco.appendChild(el("p", "p1-bloco-ajuda", descricao));
    return bloco;
  }

  function secaoRenomear() {
    var form = el("form", "p1-form-renomear");
    var nome = campo(form, "Renomear a carteira", "text", { maxlength: "120", required: "required" });
    nome.value = estado.selecionado.nome;
    var salvar = el("button", "btn-secundario", "Salvar nome");
    salvar.type = "submit";
    salvar.setAttribute("type", "submit");
    form.appendChild(salvar);
    form.addEventListener("submit", async function (evento) {
      evento.preventDefault();
      try {
        await api().renomearPortfolio(estado.selecionado.id, String(nome.value || "").trim());
        estado.selecionado.nome = String(nome.value || "").trim();
        definirStatus(portfoliosStatus, "Carteira renomeada.");
        renderListaPortfolios();
        renderDetalhe();
      } catch (erro) {
        tratarFalha(erro, portfoliosStatus, true);
      }
    });
    return form;
  }

  // --- processos monitorados --------------------------------------------------

  function secaoItens() {
    var bloco = secao("Processos monitorados",
      "Cada processo é reconsultado no intervalo escolhido; mudanças de estágio viram alerta no resumo diário.");
    var colunas = ["Número", "Intervalo (min)", "Próxima consulta", "Histórico"];
    if (ehCriador()) colunas.push("Ações");
    var t = tabela(colunas);
    var corpo = corpoDaTabela(t);

    if (!estado.itens.length) {
      bloco.appendChild(el("p", "p1-vazio", "Nenhum processo monitorado nesta carteira."));
    } else {
      estado.itens.forEach(function (item) {
        var linha = el("tr");
        celula(linha, numeroLegivel(item.numero || ""), "p1-numero");
        if (ehCriador()) {
          var intervalo = el("input", "p1-intervalo-item");
          intervalo.type = "number";
          intervalo.setAttribute("type", "number");
          intervalo.setAttribute("min", "1");
          intervalo.setAttribute("max", String(MAX_INTERVALO_MINUTOS));
          intervalo.setAttribute("aria-label", "Intervalo em minutos");
          intervalo.value = String(item.intervaloMinutos || "");
          celula(linha, intervalo);
        } else {
          celula(linha, String(item.intervaloMinutos || "—"));
        }
        celula(linha, dataLegivel(item.proximaConsultaEm));
        var verHistorico = botao("p1-ver-historico", "Ver histórico");
        verHistorico.addEventListener("click", function () { return abrirHistorico(item.numero); });
        celula(linha, verHistorico);

        if (ehCriador()) {
          var acoes = el("td");
          var salvar = botao("p1-salvar-item", "Salvar");
          salvar.addEventListener("click", async function () {
            try {
              await api().atualizarItem(estado.selecionado.id, item.id, Number(intervalo.value));
              definirStatus(portfoliosStatus, "Intervalo atualizado.");
              await recarregarSelecionado();
            } catch (erro) {
              tratarFalha(erro, portfoliosStatus, true);
            }
          });
          var remover = botao("p1-remover-item", "Remover");
          remover.addEventListener("click", async function () {
            try {
              await api().removerItem(estado.selecionado.id, item.id);
              definirStatus(portfoliosStatus, "Processo removido do monitoramento.");
              await recarregarSelecionado();
            } catch (erro) {
              tratarFalha(erro, portfoliosStatus, true);
            }
          });
          acoes.appendChild(salvar);
          acoes.appendChild(remover);
          linha.appendChild(acoes);
        }
        corpo.appendChild(linha);
      });
      bloco.appendChild(envolverTabela(t));
    }

    if (ehCriador()) bloco.appendChild(formularioItem());
    return bloco;
  }

  function formularioItem() {
    var form = el("form", "p1-form-item");
    // O vínculo é com um processo já consultado: a rota recebe o identificador
    // do processo, não o número CNJ. Ver api/portfolios/items.js.
    var processo = campo(form, "Identificador do processo já consultado", "text", {
      placeholder: "00000000-0000-0000-0000-000000000000",
      required: "required",
    });
    var intervalo = campo(form, "Intervalo entre consultas (minutos)", "number", {
      min: "1", max: String(MAX_INTERVALO_MINUTOS), required: "required",
    });
    intervalo.value = String(INTERVALO_PADRAO_MINUTOS);
    var enviar = el("button", "btn-consultar", "Monitorar processo");
    enviar.type = "submit";
    enviar.setAttribute("type", "submit");
    form.appendChild(enviar);
    form.addEventListener("submit", async function (evento) {
      evento.preventDefault();
      try {
        await api().adicionarItem(estado.selecionado.id, String(processo.value || "").trim(), Number(intervalo.value));
        definirStatus(portfoliosStatus, "Processo incluído no monitoramento.");
        await recarregarSelecionado();
      } catch (erro) {
        tratarFalha(erro, portfoliosStatus, true);
      }
    });
    return form;
  }

  // --- membros ----------------------------------------------------------------

  function secaoMembros() {
    var bloco = secao("Membros",
      "Membros leem a carteira e recebem o resumo diário. Só o criador inclui ou remove pessoas.");
    if (!estado.membros.length) {
      bloco.appendChild(el("p", "p1-vazio", "Nenhum membro convidado."));
    } else {
      var lista = el("ul", "p1-membros");
      estado.membros.forEach(function (membro) {
        var item = el("li");
        item.appendChild(el("span", "p1-membro-email", membro.email));
        if (ehCriador()) {
          var remover = botao("p1-remover-membro", "Remover");
          remover.addEventListener("click", async function () {
            try {
              await api().removerMembro(estado.selecionado.id, membro.id);
              definirStatus(portfoliosStatus, "Membro removido.");
              await recarregarSelecionado();
            } catch (erro) {
              tratarFalha(erro, portfoliosStatus, true);
            }
          });
          item.appendChild(remover);
        }
        lista.appendChild(item);
      });
      bloco.appendChild(lista);
    }

    if (ehCriador()) {
      var form = el("form", "p1-form-membro");
      var email = campo(form, "E-mail do membro", "email", { required: "required", autocomplete: "off" });
      var enviar = el("button", "btn-secundario", "Convidar membro");
      enviar.type = "submit";
      enviar.setAttribute("type", "submit");
      form.appendChild(enviar);
      form.addEventListener("submit", async function (evento) {
        evento.preventDefault();
        try {
          await api().adicionarMembro(estado.selecionado.id, String(email.value || "").trim());
          definirStatus(portfoliosStatus, "Membro convidado.");
          await recarregarSelecionado();
        } catch (erro) {
          tratarFalha(erro, portfoliosStatus, true);
        }
      });
      bloco.appendChild(form);
    }
    return bloco;
  }

  // --- monitorar o processo recém-consultado ----------------------------------

  // O momento natural de dizer "acompanhe este processo" é logo depois de
  // encontrá-lo. `processId` vem da resposta de /api/datajud — o mesmo campo
  // que `POST /api/portfolios/items` exige e que nenhuma outra tela produz.
  // Devolve null só quando não há processo persistido (modo sem SSO).
  function blocoMonitorar(processId) {
    if (!processId) return null;
    var bloco = el("div", "p1-monitorar-acao");

    if (!estado.selecionado) {
      bloco.appendChild(el("span", "consulta-nota",
        "Abra uma carteira sua em “Carteiras monitoradas” para acompanhar este processo."));
      return bloco;
    }
    if (!ehCriador()) {
      bloco.appendChild(el("span", "consulta-nota",
        "Só o criador da carteira “" + estado.selecionado.nome + "” pode incluir processos nela."));
      return bloco;
    }

    var acao = botao("p1-monitorar", "Monitorar em “" + estado.selecionado.nome + "”");
    acao.addEventListener("click", async function () {
      var carteira = estado.selecionado;
      acao.disabled = true;
      try {
        await api().adicionarItem(carteira.id, processId, INTERVALO_PADRAO_MINUTOS);
        limpar(bloco);
        bloco.appendChild(el("span", "consulta-nota",
          "Processo incluído no monitoramento de “" + carteira.nome + "”, com reconsulta diária. O intervalo pode ser ajustado na carteira."));
        await recarregarSelecionado();
      } catch (erro) {
        acao.disabled = false;
        var aviso = el("span", "p1-monitorar-erro");
        var codigo = (erro && erro.message) || "erro_servidor";
        aviso.textContent = codigo === "autenticacao_sso" || codigo === "autenticacao_necessaria"
          ? mensagemErro("autenticacao_necessaria")
          : mensagemErro(codigo);
        bloco.appendChild(aviso);
      }
    });
    bloco.appendChild(acao);
    return bloco;
  }

  // --- sondas de saúde --------------------------------------------------------

  function secaoProbes() {
    var bloco = secao("Sondas de saúde",
      "Uma consulta periódica por tribunal, para separar 'processo sem novidade' de 'tribunal fora do ar'.");
    var colunas = ["Número", "Índice do DataJud", "Intervalo (min)", "Sinal nesta sessão"];
    if (ehCriador()) colunas.push("Ações");
    var t = tabela(colunas);
    var corpo = corpoDaTabela(t);

    if (!estado.probes.length) {
      bloco.appendChild(el("p", "p1-vazio", "Nenhuma sonda configurada."));
    } else {
      estado.probes.forEach(function (probe) {
        var linha = el("tr");
        celula(linha, numeroLegivel(probe.numero || ""), "p1-numero");
        celula(linha, probe.alias || "—");
        celula(linha, String(probe.intervaloMinutos || "—"));
        celulasSinal.push({ alias: probe.alias, celula: celula(linha, sinalDoTribunal(probe.alias)) });
        if (ehCriador()) {
          var acoes = el("td");
          var remover = botao("p1-remover-probe", "Remover");
          remover.addEventListener("click", async function () {
            try {
              await api().removerProbe(estado.selecionado.id, probe.id);
              definirStatus(portfoliosStatus, "Sonda removida.");
              await recarregarSelecionado();
            } catch (erro) {
              tratarFalha(erro, portfoliosStatus, true);
            }
          });
          acoes.appendChild(remover);
          linha.appendChild(acoes);
        }
        corpo.appendChild(linha);
      });
      bloco.appendChild(envolverTabela(t));
    }

    bloco.appendChild(el("p", "p1-bloco-ajuda",
      "O sinal vem das consultas feitas neste navegador nesta sessão; as medições agendadas ficam no histórico do servidor."));

    if (ehCriador()) {
      var form = el("form", "p1-form-probe");
      var numero = campo(form, "Número do processo usado como sonda", "text", {
        inputmode: "numeric", placeholder: "0000000-00.0000.0.00.0000", required: "required",
      });
      var sugestoes = el("div", "p1-sugestoes-campo");
      form.appendChild(sugestoes);
      ligarSugestoes(numero, sugestoes);
      var intervalo = campo(form, "Intervalo entre medições (minutos)", "number", {
        min: "1", max: String(MAX_INTERVALO_MINUTOS), required: "required",
      });
      intervalo.value = String(INTERVALO_PADRAO_MINUTOS);
      var enviar = el("button", "btn-secundario", "Criar sonda");
      enviar.type = "submit";
      enviar.setAttribute("type", "submit");
      form.appendChild(enviar);
      form.addEventListener("submit", async function (evento) {
        evento.preventDefault();
        var c = cnj();
        try {
          await api().criarProbe(estado.selecionado.id, c ? c.normalize(numero.value) : numero.value, Number(intervalo.value));
          definirStatus(portfoliosStatus, "Sonda criada.");
          await recarregarSelecionado();
        } catch (erro) {
          tratarFalha(erro, portfoliosStatus, true);
        }
      });
      bloco.appendChild(form);
    }
    return bloco;
  }

  // --- histórico e diff -------------------------------------------------------

  async function abrirHistorico(numero) {
    if (historicoNumero) historicoNumero.value = numeroLegivel(numero || "");
    await consultarHistorico();
  }

  async function consultarHistorico() {
    if (!historicoNumero) return;
    var c = cnj();
    var digitos = c ? c.normalize(historicoNumero.value) : String(historicoNumero.value || "");
    limpar(historicoResultado);
    if (digitos.length !== 20) {
      definirStatus(historicoStatus, mensagemErro("numero_invalido"));
      return;
    }
    definirStatus(historicoStatus, "Carregando histórico…");
    try {
      var retorno = await api().consultarHistorico(digitos);
      definirStatus(historicoStatus, "");
      renderHistorico(retorno);
    } catch (erro) {
      tratarFalha(erro, historicoStatus, true);
    }
  }

  function renderHistorico(retorno) {
    if (!historicoResultado) return;
    limpar(historicoResultado);
    var snapshots = (retorno && retorno.snapshots) || [];
    if (!snapshots.length) {
      historicoResultado.appendChild(el("p", "p1-vazio",
        "Ainda não há consultas registradas para este processo."));
      return;
    }

    var delta = retorno && retorno.delta;
    if (delta) {
      var bloco = el("p", "p1-delta");
      bloco.appendChild(el("span", "p1-delta-rotulo", "Mudança desde a consulta anterior: "));
      bloco.appendChild(doc.createTextNode(
        rotuloEstagio(delta.anterior) + " → " + rotuloEstagio(delta.atual) + " "));
      bloco.appendChild(badge(delta.relevante ? "relevante" : "sem impacto", delta.relevante ? "ok" : "warn"));
      historicoResultado.appendChild(bloco);
    } else {
      historicoResultado.appendChild(el("p", "p1-bloco-ajuda",
        "Só há uma consulta registrada — a comparação aparece a partir da segunda."));
    }

    var t = tabela(["Consultado em", "Estágio (TPU)", "Código", "Data do movimento", "Versão do catálogo"]);
    var corpo = corpoDaTabela(t);
    snapshots.forEach(function (snapshot) {
      var linha = el("tr");
      celula(linha, dataLegivel(snapshot.consultadoEm));
      celula(linha, rotuloEstagio(snapshot.estagio));
      celula(linha, snapshot.codigo === null || snapshot.codigo === undefined ? "—" : String(snapshot.codigo));
      celula(linha, snapshot.data ? dataLegivel(snapshot.data) : "—");
      celula(linha, snapshot.versao || "—");
      corpo.appendChild(linha);
    });
    historicoResultado.appendChild(envolverTabela(t));
  }

  // --- inicialização ----------------------------------------------------------

  function init() {
    glossarioBusca = doc.getElementById("glossario-busca");
    glossarioResultado = doc.getElementById("glossario-resultado");
    portfoliosStatus = doc.getElementById("portfolios-status");
    portfolioForm = doc.getElementById("portfolio-form");
    portfolioNome = doc.getElementById("portfolio-nome");
    portfoliosLista = doc.getElementById("portfolios-lista");
    portfolioDetalhe = doc.getElementById("portfolio-detalhe");
    historicoForm = doc.getElementById("historico-form");
    historicoNumero = doc.getElementById("historico-numero");
    historicoStatus = doc.getElementById("historico-status");
    historicoResultado = doc.getElementById("historico-resultado");

    if (glossarioBusca && glossarioResultado) {
      glossarioBusca.addEventListener("input", renderGlossario);
      renderGlossario();
    }

    if (historicoForm) {
      historicoForm.addEventListener("submit", function (evento) {
        evento.preventDefault();
        return consultarHistorico();
      });
      var sugestoesHistorico = doc.getElementById("historico-sugestoes");
      if (sugestoesHistorico) ligarSugestoes(historicoNumero, sugestoesHistorico);
    }

    if (portfolioForm && portfolioNome) {
      portfolioForm.addEventListener("submit", async function (evento) {
        evento.preventDefault();
        var nome = String(portfolioNome.value || "").trim();
        if (!nome) {
          definirStatus(portfoliosStatus, mensagemErro("portfolio_invalido"));
          return;
        }
        try {
          var criada = await api().criarPortfolio(nome);
          portfolioNome.value = "";
          definirStatus(portfoliosStatus, "Carteira criada.");
          estado.portfolios = estado.portfolios.concat([criada]);
          renderListaPortfolios();
          await selecionarPortfolio(criada);
        } catch (erro) {
          tratarFalha(erro, portfoliosStatus, true);
        }
      });
    }

    // Abrir a página não pode levar ninguém ao Entra: o decodificador offline é
    // público. Sem sessão, o painel mostra um botão "Entrar" e para por aí.
    if (portfoliosLista && api()) carregarPortfolios(false);
  }

  global.P1Ui = {
    GLOSSARIO_TPU: GLOSSARIO_TPU,
    buscarGlossario: buscarGlossario,
    rotuloEstagio: rotuloEstagio,
    blocoSugestoes: blocoSugestoes,
    blocoMonitorar: blocoMonitorar,
    recarregarCarteiras: function () { return carregarPortfolios(false); },
    mensagemP1: mensagemP1,
    mensagemErro: mensagemErro,
    classificarTribunal: classificarTribunal,
    registrarEstadoTribunal: registrarEstadoTribunal,
    estadoTribunal: estadoTribunal,
  };

  if (doc) {
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init);
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
