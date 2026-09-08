// DOM mínimo para rodar os scripts clássicos de js/ sob node:test.
// Só implementa o que a interface realmente usa: criação de nós, texto,
// atributos e eventos. Nada aqui interpreta HTML — é exatamente por isso que
// serve como prova de que a interface não gera markup a partir de dado remoto.

export class No {
  constructor(tag, documento, texto = "") {
    this.tagName = tag.toUpperCase();
    this.nodeType = tag === "#text" ? 3 : 1;
    this.documento = documento;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this._text = texto;
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.open = false;
  }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this._text + this.children.map((filho) => filho.textContent).join(""); }
  set textContent(valor) { this._text = String(valor); this.children = []; }
  appendChild(filho) { this.children.push(filho); filho.parentNode = this; return filho; }
  removeChild(filho) { this.children.splice(this.children.indexOf(filho), 1); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(nome, valor) { this.attributes.set(nome, String(valor)); }
  removeAttribute(nome) { this.attributes.delete(nome); }
  getAttribute(nome) { return this.attributes.get(nome) || null; }
  addEventListener(tipo, fn) {
    const lista = this.listeners.get(tipo) || [];
    lista.push(fn);
    this.listeners.set(tipo, lista);
  }
  async dispatch(tipo, extra = {}) {
    for (const fn of this.listeners.get(tipo) || []) {
      await fn({ type: tipo, preventDefault() {}, key: "", ...extra });
    }
  }
  click() { return this.dispatch("click"); }
  focus() { this.documento.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; void this.dispatch("close"); }
}

// Ids do decodificador (js/app.js) e da interface P1 (js/p1-ui.js). Manter os
// dois no mesmo lugar deixa qualquer teste carregar os dois scripts juntos.
export const IDS_PADRAO = {
  "cnj-input": "input",
  resultado: "section",
  "resultado-online": "section",
  contador: "div",
  "login-dialog": "dialog",
  "login-form": "form",
  "login-password": "input",
  "login-error": "p",
  "login-submit": "button",
  "login-cancel": "button",
  "session-logout": "button",
  "batch-form": "form",
  "batch-numbers": "textarea",
  "batch-file": "input",
  "batch-submit": "button",
  "batch-status": "p",
  "batch-itens": "div",
  "batch-export": "a",
  "batch-export-xlsx": "a",
  "glossario-busca": "input",
  "glossario-resultado": "div",
  "portfolios-status": "p",
  "portfolio-form": "form",
  "portfolio-nome": "input",
  "portfolios-lista": "div",
  "portfolio-detalhe": "div",
  "historico-form": "form",
  "historico-numero": "input",
  "historico-status": "p",
  "historico-resultado": "div",
  "tokens-status": "p",
  "token-form": "form",
  "token-nome": "input",
  "token-limite": "input",
  "token-emitido": "div",
  "tokens-lista": "div",
  "trilha-status": "p",
  "trilha-lista": "div",
  "trilha-anterior": "button",
  "trilha-proxima": "button",
  "trilha-atualizar": "button",
};

export function documentoFake(ids = IDS_PADRAO) {
  const registro = new Map();
  const doc = {
    readyState: "complete",
    activeElement: null,
    createElement(tag) { return new No(tag, doc); },
    createTextNode(texto) { return new No("#text", doc, String(texto)); },
    getElementById(id) { return registro.get(id); },
    querySelectorAll() { return []; },
  };
  for (const [id, tag] of Object.entries(ids)) registro.set(id, new No(tag, doc));
  return doc;
}

export function achar(node, predicado) {
  if (!node) return null;
  if (predicado(node)) return node;
  for (const filho of node.children || []) {
    const achado = achar(filho, predicado);
    if (achado) return achado;
  }
  return null;
}

export function todos(node, predicado) {
  const encontrados = [];
  (function varrer(atual) {
    if (!atual) return;
    if (predicado(atual)) encontrados.push(atual);
    for (const filho of atual.children || []) varrer(filho);
  })(node);
  return encontrados;
}
