import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

class No {
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
  addEventListener(tipo, fn) { const lista = this.listeners.get(tipo) || []; lista.push(fn); this.listeners.set(tipo, lista); }
  async dispatch(tipo, extra = {}) { for (const fn of this.listeners.get(tipo) || []) await fn({ type: tipo, preventDefault() {}, key: "", ...extra }); }
  click() { return this.dispatch("click"); }
  focus() { this.documento.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; void this.dispatch("close"); }
}

function documentoFake() {
  const ids = new Map();
  const doc = {
    readyState: "complete",
    activeElement: null,
    createElement(tag) { return new No(tag, doc); },
    createTextNode(texto) { return new No("#text", doc, String(texto)); },
    getElementById(id) { return ids.get(id); },
    querySelectorAll() { return []; },
  };
  for (const [id, tag] of Object.entries({
    "cnj-input": "input", resultado: "section", "resultado-online": "section", contador: "div",
    "login-dialog": "dialog", "login-form": "form", "login-password": "input", "login-error": "p",
    "login-submit": "button", "login-cancel": "button", "session-logout": "button",
    "batch-form": "form", "batch-numbers": "textarea", "batch-file": "input", "batch-submit": "button", "batch-status": "p",
    "batch-export": "a",
    "batch-export-xlsx": "a",
  })) ids.set(id, new No(tag, doc));
  return doc;
}

function achar(node, predicado) {
  if (predicado(node)) return node;
  for (const filho of node.children || []) { const achado = achar(filho, predicado); if (achado) return achado; }
  return null;
}

test("login retenta consulta, restaura foco e renderiza payload XSS como texto", async () => {
  const document = documentoFake();
  let consultas = 0;
  const malicioso = '<img src=x onerror="globalThis.pwned=1">';
  const api = {
    verificarSessao: async () => { throw new Error("autenticacao_necessaria"); },
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => {
      consultas += 1;
      if (consultas === 1) throw new Error("autenticacao_necessaria");
      return { encontrado: true, processos: [{ classe: { nome: malicioso }, assuntos: [], movimentos: [], grau: "G1" }] };
    },
  };
  const global = {
    document,
    CNJ: {
      normalize: (valor) => String(valor).replace(/\D/g, ""),
      format: (valor) => valor,
      describe: (digitos) => ({ digitos, valido: true, sequencial: "0001327", verificador: "88", ano: "2018", segmento: "8", segmentoNome: "Estadual", tribunal: "26", tribunalNome: "TJSP", tribunalConhecido: true, origem: "0344", formatado: digitos }),
    },
    CNJ_TABLES: { deriveAlias: () => ({ alias: "api_publica_tjsp" }) },
    CNJApi: api,
    Date,
    setTimeout,
    clearTimeout,
  };
  global.window = global;
  global.globalThis = global;
  vm.runInContext(readFileSync("js/app.js", "utf8"), vm.createContext(global), { filename: "js/app.js" });

  const input = document.getElementById("cnj-input");
  input.value = "00013278820188260344";
  await input.dispatch("input");
  const consultar = achar(document.getElementById("resultado"), (node) => node.className === "btn-consultar");
  consultar.focus();
  await consultar.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("login-dialog").open, true);
  assert.equal(document.activeElement, document.getElementById("login-password"));

  document.getElementById("login-password").value = "senha";
  await document.getElementById("login-form").dispatch("submit");
  assert.equal(consultas, 2);
  assert.equal(document.activeElement, consultar);
  const online = document.getElementById("resultado-online");
  assert.match(online.textContent, /<img src=x/);
  assert.equal(achar(online, (node) => node.tagName === "IMG"), null);
  assert.equal(global.pwned, undefined);
});

test("consulta sem sessão Entra redireciona sem abrir diálogo de senha", async () => {
  const document = documentoFake();
  let iniciouSso = 0;
  const api = {
    verificarSessao: async () => { throw new Error("autenticacao_necessaria"); },
    iniciarSso() { iniciouSso += 1; },
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => { throw new Error("autenticacao_sso"); },
  };
  const global = {
    document,
    CNJ: {
      normalize: (valor) => String(valor).replace(/\D/g, ""),
      format: (valor) => valor,
      describe: (digitos) => ({ digitos, valido: true, sequencial: "0001327", verificador: "88", ano: "2018", segmento: "8", segmentoNome: "Estadual", tribunal: "26", tribunalNome: "TJSP", tribunalConhecido: true, origem: "0344", formatado: digitos }),
    },
    CNJ_TABLES: { deriveAlias: () => ({ alias: "api_publica_tjsp" }) },
    CNJApi: api,
    Date,
    setTimeout,
    clearTimeout,
  };
  global.window = global;
  global.globalThis = global;
  vm.runInContext(readFileSync("js/app.js", "utf8"), vm.createContext(global), { filename: "js/app.js" });

  const input = document.getElementById("cnj-input");
  input.value = "00013278820188260344";
  await input.dispatch("input");
  const consultar = achar(document.getElementById("resultado"), (node) => node.className === "btn-consultar");
  await consultar.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(iniciouSso, 1);
  assert.equal(document.getElementById("login-dialog").open, false);
});

test("modo Entra inicia login ao abrir a ferramenta", async () => {
  const document = documentoFake();
  let iniciouSso = 0;
  const api = {
    verificarSessao: async () => { throw new Error("autenticacao_sso"); },
    iniciarSso() { iniciouSso += 1; },
    entrar: async () => true,
    sair: async () => true,
    consultarProcesso: async () => ({ encontrado: false, processos: [] }),
  };
  const global = { document, CNJ: { normalize: () => "", format: () => "", describe: () => null }, CNJ_TABLES: { deriveAlias: () => ({ alias: null }) }, CNJApi: api, Date, setTimeout, clearTimeout };
  global.window = global;
  global.globalThis = global;
  vm.runInContext(readFileSync("js/app.js", "utf8"), vm.createContext(global), { filename: "js/app.js" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(iniciouSso, 1);
});
