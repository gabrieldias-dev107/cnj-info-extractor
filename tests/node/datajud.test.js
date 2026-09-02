import assert from "node:assert/strict";
import test from "node:test";
import { jsonResponse, request, response } from "./helpers/http.js";

process.env.DATAJUD_API_KEY = "chave-de-teste";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-teste";
process.env.APP_ACCESS_PASSWORD = "senha-compartilhada-segura";
process.env.SESSION_SECRET = "segredo-de-sessao-com-pelo-menos-32-caracteres";

const { default: handler, ordenarInstancias } = await import("../../api/datajud.js");
const { criarTokenSessao } = await import("../../server/auth.js");

const NUMERO = "00013278820188260344";
const ALIAS = "api_publica_tjsp";

function hitsResposta() {
  return {
    hits: {
      hits: [
        { _source: { numeroProcesso: NUMERO, grau: "G2", dataHoraUltimaAtualizacao: "2026-01-03T10:00:00Z", movimentos: [] } },
        { _source: { numeroProcesso: NUMERO, grau: "G1", dataHoraUltimaAtualizacao: "2026-01-01T10:00:00Z", movimentos: [{ codigo: 1, nome: "antigo", dataHora: "2025-01-01T00:00:00Z" }, { codigo: 2, nome: "novo", dataHora: "2025-02-01T00:00:00Z" }] } },
        { _source: { numeroProcesso: NUMERO, grau: "G1", dataHoraUltimaAtualizacao: "2026-02-01T10:00:00Z", movimentos: [] } },
      ],
    },
  };
}

function redisResponse(contagens = [1, 1, 1]) {
  return jsonResponse(200, contagens.flatMap((contagem) => [{ result: contagem }, { result: 1 }]));
}

function requisicaoValida() {
  return request({ headers: { host: "app.vercel.app", origin: "https://app.vercel.app", cookie: "cnj_session=" + criarTokenSessao() }, body: { numero: NUMERO, alias: ALIAS } });
}

async function executar({ req = requisicaoValida(), fetchImpl, agora = null } = {}) {
  const anteriorFetch = globalThis.fetch;
  const anteriorAgora = Date.now;
  const anteriorLog = console.log;
  const anteriorErro = console.error;
  const logs = [];
  globalThis.fetch = fetchImpl;
  if (agora !== null) Date.now = () => agora;
  console.log = (linha) => logs.push(linha);
  console.error = (linha) => logs.push(linha);
  const res = response();
  try {
    await handler(req, res);
    return { res, logs };
  } finally {
    globalThis.fetch = anteriorFetch;
    Date.now = anteriorAgora;
    console.log = anteriorLog;
    console.error = anteriorErro;
  }
}

test("DataJud devolve contrato de lista e ordena instâncias e movimentos", async () => {
  const { res, logs } = await executar({
    fetchImpl: async (url) => url.startsWith("https://redis.test") ? redisResponse() : jsonResponse(200, hitsResposta()),
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.processos.map((processo) => processo.grau), ["G1", "G1", "G2"]);
  assert.equal(res.body.encontrado, true);
  assert.equal(res.body.total, 3);
  assert.deepEqual(res.body.processos[1].movimentos.map((movimento) => movimento.nome), ["novo", "antigo"]);
  assert.equal(JSON.parse(logs.at(-1)).evento, "consulta_ok");
  assert.equal(logs.join(" ").includes(NUMERO), false);
  assert.equal(logs.join(" ").includes("…0344"), true);
});

// Sem SSO não há banco, então não há processo persistido para monitorar. O
// campo segue a mesma regra de `estagio`: só existe no modo com sessão Entra.
test("sem SSO a resposta não inventa processId", async () => {
  const { res } = await executar({
    fetchImpl: async (url) => (String(url).includes("redis") ? redisResponse() : jsonResponse(200, hitsResposta())),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.processId, undefined);
  assert.equal(res.body.estagio, undefined);
});

test("DataJud recusa origem externa antes de chamar serviços externos", async () => {
  let chamadas = 0;
  const { res } = await executar({
    req: request({ headers: { host: "app.vercel.app", origin: "https://externo.example", cookie: "cnj_session=" + criarTokenSessao() }, body: { numero: NUMERO, alias: ALIAS } }),
    fetchImpl: async () => { chamadas += 1; return redisResponse(); },
  });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "origem_nao_permitida" });
  assert.equal(chamadas, 0);
  assert.equal(res.headers.get("vary"), "Origin");
});

test("DataJud exige sessão antes de Redis e CNJ", async () => {
  let chamadas = 0;
  const { res } = await executar({
    req: request({ headers: { host: "app.vercel.app", origin: "https://app.vercel.app" }, body: { numero: NUMERO, alias: ALIAS } }),
    fetchImpl: async () => { chamadas += 1; return redisResponse(); },
  });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "autenticacao_necessaria" });
  assert.equal(chamadas, 0);
});

test("DataJud limita alias antes de chamar serviços externos", async () => {
  let chamadas = 0;
  const req = requisicaoValida();
  req.body.alias = "api_publica_" + "a".repeat(53);
  const { res } = await executar({ req, fetchImpl: async () => { chamadas += 1; return redisResponse(); } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "alias_invalido" });
  assert.equal(chamadas, 0);
});

// Regressão do BUG-3: o alias vinha do corpo e só era validado por formato, o
// que deixava o cliente escolher qual índice do DataJud o servidor consultava.
test("DataJud recusa alias divergente do derivado do número", async () => {
  let chamadas = 0;
  const req = requisicaoValida();
  req.body.alias = "api_publica_trf1"; // número é do TJSP
  const { res } = await executar({ req, fetchImpl: async () => { chamadas += 1; return redisResponse(); } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "alias_invalido" });
  assert.equal(chamadas, 0, "não pode chegar ao índice escolhido pelo cliente");
});

test("DataJud consulta o índice derivado, ignorando ausência de alias no corpo", async () => {
  const urls = [];
  const req = requisicaoValida();
  delete req.body.alias;
  const { res } = await executar({
    req,
    fetchImpl: async (url) => { urls.push(url); return url.startsWith("https://redis.test") ? redisResponse() : jsonResponse(200, hitsResposta()); },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(urls.some((url) => url.includes("/api_publica_tjsp/_search")), true);
});

test("DataJud recusa número com dígito verificador inválido", async () => {
  let chamadas = 0;
  const req = requisicaoValida();
  req.body.numero = "00013278820188260345";
  const { res } = await executar({ req, fetchImpl: async () => { chamadas += 1; return redisResponse(); } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "numero_invalido" });
  assert.equal(chamadas, 0);
});

test("DataJud traduz erros do tribunal e rede na taxonomia pública", async () => {
  const casos = [
    [404, "alias_inexistente", 502],
    [429, "cota_excedida", 502],
    [503, "tribunal_indisponivel", 502],
  ];

  for (const [statusDatajud, erro, status] of casos) {
    const { res } = await executar({
      fetchImpl: async (url) => url.startsWith("https://redis.test") ? redisResponse() : jsonResponse(statusDatajud, {}),
    });
    assert.equal(res.statusCode, status);
    assert.deepEqual(res.body, { error: erro });
  }

  const { res } = await executar({
    fetchImpl: async (url) => {
      if (url.startsWith("https://redis.test")) return redisResponse();
      throw new Error("socket closed");
    },
  });
  assert.equal(res.statusCode, 504);
  assert.deepEqual(res.body, { error: "rede_indisponivel" });
});

test("DataJud devolve Retry-After quando o limite compartilhado é excedido", async () => {
  const { res } = await executar({
    agora: 61001,
    fetchImpl: async (url) => url.startsWith("https://redis.test") ? redisResponse([31, 1, 1]) : jsonResponse(200, hitsResposta()),
  });

  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: "limite_excedido" });
  assert.equal(res.headers.get("retry-after"), "59");
});

test("ordenarInstancias mantém desconhecidos depois dos graus conhecidos", () => {
  const ordenadas = ordenarInstancias([
    { grau: "X", dataHoraUltimaAtualizacao: "2026-03-01T00:00:00Z" },
    { grau: "SUP", dataHoraUltimaAtualizacao: "2026-01-01T00:00:00Z" },
    { grau: "JE", dataHoraUltimaAtualizacao: "2026-01-01T00:00:00Z" },
  ]);
  assert.deepEqual(ordenadas.map((item) => item.grau), ["JE", "SUP", "X"]);
});
