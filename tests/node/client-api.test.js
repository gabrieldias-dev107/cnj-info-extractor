import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function cliente(fetchImpl, cacheInicial = {}) {
  const dados = new Map(Object.entries(cacheInicial));
  const global = {
    Date,
    fetch: fetchImpl,
    localStorage: {
      getItem(chave) { return dados.get(chave) || null; },
      setItem(chave, valor) { dados.set(chave, valor); },
      removeItem(chave) { dados.delete(chave); },
      key(i) { return [...dados.keys()][i] || null; },
      get length() { return dados.size; },
    },
    CNJ_TABLES: { deriveAlias() { return { alias: "api_publica_tjsp" }; } },
  };
  global.window = global;
  global.globalThis = global;
  vm.runInContext(readFileSync("js/api.js", "utf8"), vm.createContext(global), { filename: "js/api.js" });
  return { api: global.CNJApi, dados };
}

function resposta(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test("consulta verifica sessão antes de ler cache protegido", async () => {
  const numero = "00013278820188260344";
  const cache = { ["datajud:v2:" + numero]: JSON.stringify({ ts: Date.now(), data: { encontrado: true, processos: [{}] } }) };
  const chamadas = [];
  const { api } = cliente(async (url, init) => { chamadas.push([url, init]); return resposta(401, { error: "autenticacao_necessaria" }); }, cache);
  await assert.rejects(() => api.consultarProcesso(numero), /autenticacao_necessaria/);
  assert.deepEqual(chamadas.map((item) => item[0]), ["/api/session"]);
});

test("entrar e sair usam rota de sessão; sair limpa apenas cache DataJud", async () => {
  const chamadas = [];
  const { api, dados } = cliente(async (url, init) => { chamadas.push([url, init]); return resposta(204); }, {
    "datajud:v2:um": "x",
    "preferencia": "preservar",
  });
  await api.entrar("senha");
  await api.sair();
  assert.deepEqual(chamadas.map((item) => [item[0], item[1].method]), [["/api/session", "POST"], ["/api/session", "DELETE"]]);
  assert.equal(dados.has("datajud:v2:um"), false);
  assert.equal(dados.get("preferencia"), "preservar");
});

test("sair limpa cache local mesmo quando a rede falha", async () => {
  const { api, dados } = cliente(async () => { throw new Error("offline"); }, { "datajud:v2:um": "x" });
  await assert.rejects(() => api.sair(), /offline/);
  assert.equal(dados.has("datajud:v2:um"), false);
});
