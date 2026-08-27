import assert from "node:assert/strict";
import test from "node:test";
import { jsonResponse } from "./helpers/http.js";

function ambiente(valores) {
  for (const [nome, valor] of Object.entries(valores)) process.env[nome] = String(valor);
}

const { consumirDatajud, consumirLogin, identificarCliente } = await import("../../server/rate-limit.js");

function redisMemoria() {
  const contagens = new Map();
  const chamadas = [];
  return {
    chamadas,
    fetch: async (_url, init) => {
      const comandos = JSON.parse(init.body);
      chamadas.push(comandos);
      return jsonResponse(200, comandos.map((comando) => {
        if (comando[0] === "INCR") {
          const valor = (contagens.get(comando[1]) || 0) + 1;
          contagens.set(comando[1], valor);
          return { result: valor };
        }
        return { result: 1 };
      }));
    },
  };
}

test("rate limit usa o primeiro IP encaminhado e janela fixa por minuto", async () => {
  ambiente({ UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "token", RL_CLIENTE_MIN: 2, RL_GLOBAL_MIN: 99, RL_GLOBAL_DIA: 99 });
  const anteriorFetch = globalThis.fetch;
  const redis = redisMemoria();
  globalThis.fetch = redis.fetch;
  try {
    const req = { headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.1" } };
    assert.notEqual(identificarCliente(req), "198.51.100.4");
    assert.equal((await consumirDatajud(req, 61001)).permitido, true);
    assert.equal((await consumirDatajud(req, 61001)).permitido, true);
    const bloqueado = await consumirDatajud(req, 61001);
    assert.deepEqual(bloqueado, { permitido: false, escopo: "cliente_minuto", limite: 2, retryAfter: 59 });
    assert.equal((await consumirDatajud(req, 120000)).permitido, true);
    assert.equal(redis.chamadas[0][1][3], "NX");
    assert.equal(JSON.stringify(redis.chamadas).includes("198.51.100.4"), false);
  } finally {
    globalThis.fetch = anteriorFetch;
  }
});

test("rate limit aplica as cotas globais por minuto e por dia", async () => {
  ambiente({ UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "token", RL_CLIENTE_MIN: 99, RL_GLOBAL_MIN: 2, RL_GLOBAL_DIA: 4 });
  const anteriorFetch = globalThis.fetch;
  const redis = redisMemoria();
  globalThis.fetch = redis.fetch;
  try {
    assert.equal((await consumirDatajud({ headers: { "x-real-ip": "um" } }, 61001)).permitido, true);
    assert.equal((await consumirDatajud({ headers: { "x-real-ip": "dois" } }, 61001)).permitido, true);
    const porMinuto = await consumirDatajud({ headers: { "x-real-ip": "tres" } }, 61001);
    assert.equal(porMinuto.escopo, "global_minuto");
    assert.equal(porMinuto.retryAfter, 59);

    assert.equal((await consumirDatajud({ headers: { "x-real-ip": "um" } }, 120000)).permitido, true);
    const porDia = await consumirDatajud({ headers: { "x-real-ip": "dois" } }, 120000);
    assert.equal(porDia.escopo, "global_dia");
    assert.equal(porDia.retryAfter, 86280);
  } finally {
    globalThis.fetch = anteriorFetch;
  }
});

test("rate limit falha aberto sem Upstash ou quando a chamada ao Redis falha", async () => {
  ambiente({ UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "" });
  assert.deepEqual(await consumirDatajud({ headers: {} }, 0), { permitido: true, indisponivel: true, motivo: "upstash_nao_configurado" });
  assert.deepEqual(await consumirLogin({ headers: {} }, 0), { permitido: false, indisponivel: true, motivo: "upstash_nao_configurado" });

  ambiente({ UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "token" });
  const anteriorFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("redis fora do ar"); };
  try {
    assert.deepEqual(await consumirDatajud({ headers: {} }, 0), { permitido: true, indisponivel: true, motivo: "redis fora do ar" });
  } finally {
    globalThis.fetch = anteriorFetch;
  }
});

test("pipeline Redis inválido falha fechado no login e aberto no DataJud", async () => {
  ambiente({ UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "token" });
  const anteriorFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(200, [{ error: "ERR indisponível" }]);
  try {
    const req = { headers: { "x-real-ip": "198.51.100.9" } };
    const login = await consumirLogin(req, 0);
    const datajud = await consumirDatajud(req, 0);
    assert.equal(login.permitido, false);
    assert.equal(login.indisponivel, true);
    assert.equal(datajud.permitido, true);
    assert.equal(datajud.indisponivel, true);
  } finally {
    globalThis.fetch = anteriorFetch;
  }
});

test("timeout Redis não deixa login pendurado", async () => {
  ambiente({ UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "token", RL_REDIS_TIMEOUT_MS: 5 });
  const anteriorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("abortado"), { name: "AbortError" })));
  });
  try {
    const resultado = await consumirLogin({ headers: {} }, 0);
    assert.equal(resultado.permitido, false);
    assert.equal(resultado.indisponivel, true);
  } finally {
    globalThis.fetch = anteriorFetch;
    delete process.env.RL_REDIS_TIMEOUT_MS;
  }
});

test("timeout Redis também cobre leitura do corpo", async () => {
  ambiente({ UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "token", RL_REDIS_TIMEOUT_MS: 5 });
  const anteriorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => ({
    ok: true,
    json: async () => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("abortado"), { name: "AbortError" })));
    }),
  });
  try {
    const resultado = await Promise.race([
      consumirLogin({ headers: {} }, 0),
      new Promise((resolve) => setTimeout(() => resolve({ pendente: true }), 30)),
    ]);
    assert.equal(resultado.pendente, undefined);
    assert.equal(resultado.permitido, false);
    assert.equal(resultado.indisponivel, true);
  } finally {
    globalThis.fetch = anteriorFetch;
    delete process.env.RL_REDIS_TIMEOUT_MS;
  }
});
