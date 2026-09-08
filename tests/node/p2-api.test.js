import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { request, response } from "./helpers/http.js";

process.env.SESSION_SECRET = "segredo-de-sessao-com-pelo-menos-32-caracteres";
process.env.DATABASE_URL = "postgres://fake/fake";

const NUMERO = "00013278820188260344";
const TOKEN = "cnjsvc_abcdefgh_" + "z".repeat(43);

const TOKEN_VALIDO = { id: "tok-1", creatorUserId: "user-1", nome: "integração", prefixo: "abcdefgh", limiteDia: 500 };

const estado = {};
const registros = {};

function reiniciar() {
  estado.token = async () => TOKEN_VALIDO;
  estado.cota = async () => ({ permitido: true });
  estado.cotaGlobal = async () => ({ permitido: true });
  estado.emCache = async () => null;
  estado.consultar = async () => ({ encontrado: true, total: 1, processos: [{ numeroProcesso: NUMERO, grau: "G1", tribunal: "TJSP", dataAjuizamento: "20180514", movimentos: [], sistema: "PJe", formato: "Eletrônico", nivelSigilo: 0 }] });
  registros.auditoria = [];
  registros.tocados = [];
  registros.persistidos = [];
}
reiniciar();

mock.module("../../server/db.js", {
  namedExports: {
    serviceTokenByHash: (...args) => estado.token(...args),
    touchServiceToken: async (id) => { registros.tocados.push(id); },
    prefixoDoToken: (token) => {
      const encontrado = /^cnjsvc_([A-Za-z0-9_-]{8})_[A-Za-z0-9_-]{20,}$/.exec(String(token || ""));
      return encontrado ? encontrado[1] : null;
    },
    freshSnapshot: (...args) => estado.emCache(...args),
    persistSnapshot: async (dados) => {
      registros.persistidos.push(dados);
      return { snapshotId: "snap-1", processId: "proc-1", estagio: { estagio: "nao_classificado", codigo: null, data: null, idadeDias: null, versao: "tpu-teste" }, score: { faixa: "prioridade_media", pontos: 45, confianca: "baixa", fatores: [], versao: "score-teste", aprovadaPorRisco: false, fonte: "indicio_publico_datajud", ressalva: "ressalva" } };
    },
    recordAuditEvent: async (evento) => { registros.auditoria.push(evento); },
  },
});

mock.module("../../server/rate-limit.js", {
  namedExports: {
    consumirTokenServico: (...args) => estado.cota(...args),
    consumirDatajud: (...args) => estado.cotaGlobal(...args),
  },
});

mock.module("../../server/datajud-client.js", {
  namedExports: { consultarDatajud: (...args) => estado.consultar(...args) },
});

const { decodificar, processos } = await import("../../server/handlers/api-v1.js");

function requisicao({ token = TOKEN, numero = NUMERO, method = "POST", headers = {} } = {}) {
  const cabecalhos = Object.assign({ host: "app.vercel.app" }, headers);
  if (token) cabecalhos.authorization = "Bearer " + token;
  return request({ method, headers: cabecalhos, body: { numero } });
}

async function executar(handler, req) {
  const anteriorErro = console.error;
  console.error = () => {};
  const res = response();
  try {
    await handler(req, res);
    return res;
  } finally {
    console.error = anteriorErro;
  }
}

test("sem Authorization a API interna responde 401 token_ausente e registra a tentativa", async () => {
  reiniciar();
  const res = await executar(decodificar, requisicao({ token: null }));

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "token_ausente" });
  assert.deepEqual(registros.auditoria.map((evento) => evento.resultado), ["negado_token_ausente"]);
  assert.deepEqual(registros.tocados, [], "token inexistente não é marcado como usado");
});

// Revogado, vencido e inexistente são o mesmo `null` vindo do SQL: distinguir os
// três diria a quem tenta se o valor já existiu.
test("token revogado, vencido ou inexistente respondem igual 401 token_invalido", async () => {
  for (const cenario of ["revogado", "vencido", "inexistente"]) {
    reiniciar();
    estado.token = async () => null;
    const res = await executar(processos, requisicao());

    assert.equal(res.statusCode, 401, cenario);
    assert.deepEqual(res.body, { error: "token_invalido" }, cenario);
    assert.deepEqual(registros.auditoria.map((evento) => evento.resultado), ["negado_token_invalido"], cenario);
  }
});

test("cota do token estourada responde 429 com Retry-After e não chega ao DataJud", async () => {
  reiniciar();
  let chamouDatajud = 0;
  estado.consultar = async () => { chamouDatajud += 1; return { encontrado: false, total: 0, processos: [] }; };
  estado.cota = async () => ({ permitido: false, escopo: "token_dia", limite: 500, retryAfter: 3600 });

  const res = await executar(processos, requisicao());

  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: "limite_excedido" });
  assert.equal(res.headers.get("retry-after"), "3600");
  assert.equal(chamouDatajud, 0);
  assert.deepEqual(registros.auditoria.map((evento) => evento.resultado), ["negado_cota_excedida"]);
});

// Fail-closed: com o contador fora do ar a chamada é negada, senão o consumo
// externo furaria a cota diária reservada à operação.
test("cota indisponível nega a chamada e registra o motivo próprio", async () => {
  reiniciar();
  estado.cota = async () => ({ permitido: false, indisponivel: true, motivo: "upstash_nao_configurado" });

  const res = await executar(processos, requisicao());

  assert.equal(res.statusCode, 429);
  assert.deepEqual(registros.auditoria.map((evento) => evento.resultado), ["negado_cota_indisponivel"]);
});

test("decodificar devolve a estrutura do número e o alias, sem tocar no DataJud", async () => {
  reiniciar();
  let chamouDatajud = 0;
  estado.consultar = async () => { chamouDatajud += 1; return {}; };

  const res = await executar(decodificar, requisicao());

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    numero: NUMERO,
    formatado: "0001327-88.2018.8.26.0344",
    valido: true,
    sequencial: "0001327",
    digitoVerificador: "88",
    digitoEsperado: "88",
    ano: "2018",
    segmento: "8",
    tribunal: "26",
    origem: "0344",
    alias: "api_publica_tjsp",
    consultaOnlineDisponivel: true,
  });
  assert.equal(chamouDatajud, 0);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(registros.tocados, ["tok-1"], "o uso do token é datado");
  assert.deepEqual(registros.auditoria.map((evento) => [evento.acao, evento.resultado]), [["api_v1", "sucesso"]]);
});

// O alias é sempre derivado no servidor; o cliente não escolhe índice do
// DataJud nem por esta rota.
test("dígito verificador errado é reportado sem inventar correção", async () => {
  reiniciar();
  // Só o dígito verificador muda; o resto do número é o mesmo do caso válido.
  const res = await executar(decodificar, requisicao({ numero: "00013279920188260344" }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.valido, false);
  assert.equal(res.body.digitoEsperado, "88");
  assert.equal(res.body.alias, null);
  assert.equal(res.body.consultaOnlineDisponivel, false);
});

test("número fora de 20 dígitos é 400 e entra na trilha", async () => {
  reiniciar();
  const res = await executar(decodificar, requisicao({ numero: "123" }));

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "numero_invalido" });
  assert.deepEqual(registros.auditoria.map((evento) => evento.resultado), ["negado_numero_invalido"]);
});

test("processos serve do cache sem ir ao DataJud e devolve estágio e score", async () => {
  reiniciar();
  let chamouDatajud = 0;
  estado.consultar = async () => { chamouDatajud += 1; return {}; };
  estado.emCache = async () => ({
    id: "snap-1",
    processId: "proc-do-cache",
    dados: { encontrado: true, total: 1, processos: [{ numeroProcesso: NUMERO, grau: "G1", movimentos: [], sistema: "PJe", nivelSigilo: 0 }] },
    estagio: { estagio: "nao_classificado", codigo: null, data: null, idadeDias: null, versao: "tpu-teste" },
    score: { faixa: "prioridade_baixa", pontos: 10, confianca: "baixa", fatores: [], versao: "score-teste", aprovadaPorRisco: false, fonte: "indicio_publico_datajud", ressalva: "ressalva" },
  });

  const res = await executar(processos, requisicao());

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cache, "servidor");
  assert.equal(res.body.processId, "proc-do-cache");
  assert.equal(chamouDatajud, 0);
  assert.equal(res.body.estagio.estagio, "nao_classificado");
  assert.equal(res.body.score.faixa, "prioridade_baixa");
  // A faixa nunca viaja sozinha.
  assert.equal(res.body.score.confianca, "baixa");
  assert.equal(res.body.score.aprovadaPorRisco, false);
  assert.ok(res.body.score.ressalva);
  // Contrato reduzido: campos que o proxy do navegador devolve e a API não promete.
  assert.equal("sistema" in res.body.processos[0], false);
  assert.equal(res.body.processos[0].nivelSigilo, 0);
  assert.deepEqual(registros.auditoria.map((evento) => [evento.resultado, evento.processId]), [["sucesso_cache", "proc-do-cache"]]);
});

test("sem cache a rota debita a cota global e persiste o snapshot", async () => {
  reiniciar();
  const res = await executar(processos, requisicao());

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cache, null);
  assert.equal(registros.persistidos.length, 1);
  assert.equal(registros.persistidos[0].alias, "api_publica_tjsp", "o alias é derivado no servidor");
  assert.deepEqual(registros.auditoria.map((evento) => evento.resultado), ["sucesso_datajud"]);
});

test("cota global esgotada bloqueia antes da rede", async () => {
  reiniciar();
  let chamouDatajud = 0;
  estado.consultar = async () => { chamouDatajud += 1; return {}; };
  estado.cotaGlobal = async () => ({ permitido: false, escopo: "global_dia", retryAfter: 120 });

  const res = await executar(processos, requisicao());

  assert.equal(res.statusCode, 429);
  assert.equal(chamouDatajud, 0);
  assert.deepEqual(registros.auditoria.map((evento) => evento.resultado), ["negado_cota_global"]);
});

test("falha do DataJud preserva a taxonomia de erro e registra a falha", async () => {
  reiniciar();
  estado.consultar = async () => { throw Object.assign(new Error("tribunal_indisponivel"), { codigo: "tribunal_indisponivel" }); };

  const res = await executar(processos, requisicao());

  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: "tribunal_indisponivel" });
  assert.deepEqual(registros.auditoria.map((evento) => evento.resultado), ["falha_tribunal_indisponivel"]);
});

test("banco fora do ar vira 503 api_indisponivel, não erro interno genérico", async () => {
  reiniciar();
  estado.token = async () => { throw new Error("banco_indisponivel"); };

  const res = await executar(processos, requisicao());

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "api_indisponivel" });
});

// Estas rotas não leem cookie: um navegador com sessão válida e sem Bearer não
// entra. É o que elimina a superfície de CSRF aqui.
test("cookie de sessão não autentica a API interna", async () => {
  reiniciar();
  const res = await executar(processos, request({
    method: "POST",
    headers: { host: "app.vercel.app", cookie: "cnj_sso=token-de-sessao-valido", origin: "https://app.vercel.app" },
    body: { numero: NUMERO },
  }));

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "token_ausente" });
});

// Chamador servidor-a-servidor não manda Origin nem sec-fetch-site; exigir
// origem quebraria a integração sem ganhar segurança, já que não há cookie.
test("ausência de Origin não impede a chamada por token", async () => {
  reiniciar();
  const res = await executar(decodificar, request({
    method: "POST",
    headers: { authorization: "Bearer " + TOKEN },
    body: { numero: NUMERO },
  }));

  assert.equal(res.statusCode, 200);
});

test("método diferente de POST é recusado antes de qualquer autenticação", async () => {
  reiniciar();
  let buscouToken = 0;
  estado.token = async () => { buscouToken += 1; return TOKEN_VALIDO; };

  for (const handler of [decodificar, processos]) {
    const res = await executar(handler, requisicao({ method: "GET" }));
    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { error: "metodo_nao_permitido" });
  }
  assert.equal(buscouToken, 0);
});

test("nenhuma resposta da API interna pode ser cacheada por intermediário", async () => {
  reiniciar();
  for (const handler of [decodificar, processos]) {
    const res = await executar(handler, requisicao());
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("vary"), "Authorization");
  }
});

test("a trilha da API interna nunca guarda o número do processo", async () => {
  reiniciar();
  await executar(processos, requisicao());
  await executar(decodificar, requisicao());

  assert.ok(registros.auditoria.length >= 2);
  assert.equal(JSON.stringify(registros.auditoria).includes(NUMERO), false);
  for (const evento of registros.auditoria) {
    assert.equal(evento.actorType, "token");
    assert.equal(evento.serviceTokenId, "tok-1");
    assert.equal(evento.atorRotulo, "t_abcdefgh");
  }
});

// --- achados da revisão Codex -----------------------------------------------

// `consumirDatajud` é fail-open por desenho, para o tráfego manual com sessão
// não parar quando o Redis cai. Herdar isso na API interna daria ao integrador
// uma chamada ao DataJud fora de qualquer contador — exatamente o que a cota
// por token existe para impedir.
test("contador global indisponível nega a chamada em vez de herdar o fail-open", async () => {
  reiniciar();
  let chamouDatajud = 0;
  estado.consultar = async () => { chamouDatajud += 1; return { encontrado: false, total: 0, processos: [] }; };
  estado.cotaGlobal = async () => ({ permitido: true, indisponivel: true, motivo: "upstash_nao_configurado" });

  const res = await executar(processos, requisicao());

  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: "limite_excedido" });
  assert.equal(chamouDatajud, 0, "nenhuma chamada ao DataJud sem contador");
  assert.deepEqual(registros.auditoria.map((evento) => evento.resultado), ["negado_cota_global_indisponivel"]);
  assert.deepEqual(registros.persistidos, []);
});

// `validarNumeroParaConsulta` mistura dígito verificador com existência de
// índice no DataJud, porque é o que a consulta precisa. Para o decodificador
// isso faria um número perfeitamente válido sair como inválido, contradizendo
// `digitoVerificador === digitoEsperado` na mesma resposta.
test("número válido de segmento sem índice público continua válido na decodificação", async () => {
  reiniciar();
  const semIndice = "00000010420262000000";
  const res = await executar(decodificar, requisicao({ numero: semIndice }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.digitoVerificador, res.body.digitoEsperado);
  assert.equal(res.body.valido, true, "o dígito verificador confere");
  assert.equal(res.body.segmento, "2");
  // O que falta é o índice, e é só isso que a resposta declara faltar.
  assert.equal(res.body.alias, null);
  assert.equal(res.body.consultaOnlineDisponivel, false);
});

test("corpo JSON nulo vira erro estruturado, nunca exceção não tratada", async () => {
  for (const handler of [decodificar, processos]) {
    reiniciar();
    const req = requisicao();
    req.body = "null";
    const res = await executar(handler, req);

    assert.equal(res.statusCode, 400, "corpo nulo é entrada inválida");
    assert.ok(res.body && res.body.error, "precisa responder com { error }");
  }

  for (const corpoInvalido of ["[]", '"texto"', "não é json", ""]) {
    reiniciar();
    const req = requisicao();
    req.body = corpoInvalido;
    const res = await executar(decodificar, req);
    assert.equal(res.statusCode, 400, JSON.stringify(corpoInvalido));
    assert.deepEqual(res.body, { error: "numero_invalido" });
  }
});
