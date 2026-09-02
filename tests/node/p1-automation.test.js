import assert from "node:assert/strict";
import test from "node:test";
import { jsonResponse } from "./helpers/http.js";

const { consumirMonitoramento, consumirSaude } = await import("../../server/rate-limit.js");
const automacao = await import("../../server/p1-automation.js");
const { enviarEmail } = await import("../../server/resend.js");

function ambiente(valores) {
  for (const [nome, valor] of Object.entries(valores)) process.env[nome] = String(valor);
}

function comUpstash() {
  ambiente({ UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "token" });
}

function semUpstash() {
  ambiente({ UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "" });
  delete process.env.UPSTASH_REDIS_KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
}

// Redis de mentira: registra os comandos do pipeline e devolve contagens reais
// para INCR, para dar de verificar limite e janela sem servidor.
function redisMemoria(valoresIniciais = {}) {
  const contagens = new Map(Object.entries(valoresIniciais));
  const chamadas = [];
  return {
    chamadas,
    contagens,
    fetch: async (_url, init) => {
      const comandos = JSON.parse(init.body);
      chamadas.push(comandos);
      return jsonResponse(200, comandos.map((comando) => {
        if (comando[0] === "INCR") {
          const valor = (Number(contagens.get(comando[1])) || 0) + 1;
          contagens.set(comando[1], valor);
          return { result: valor };
        }
        if (comando[0] === "GET") {
          const valor = contagens.get(comando[1]);
          return { result: valor === undefined ? null : valor };
        }
        if (comando[0] === "DEL") {
          contagens.delete(comando[1]);
          return { result: 1 };
        }
        return { result: 1 };
      }));
    },
  };
}

async function comFetch(fetchFalso, corpo) {
  const anterior = globalThis.fetch;
  globalThis.fetch = fetchFalso;
  try {
    return await corpo();
  } finally {
    globalThis.fetch = anterior;
  }
}

test("orçamento de monitoramento é diário, global e limitado a 480 chamadas", async () => {
  comUpstash();
  delete process.env.RL_MONITORAMENTO_DIA;
  const redis = redisMemoria({ "rl:auto:monitoramento:dia:1": 479 });
  await comFetch(redis.fetch, async () => {
    const agora = 86400000 + 1000;
    assert.equal((await consumirMonitoramento(agora)).permitido, true);
    const estourado = await consumirMonitoramento(agora);
    assert.equal(estourado.permitido, false);
    assert.equal(estourado.escopo, "monitoramento_dia");
    assert.equal(estourado.limite, 480);
  });
  const [incr, expire] = redis.chamadas[0];
  assert.deepEqual(incr, ["INCR", "rl:auto:monitoramento:dia:1"]);
  assert.deepEqual(expire, ["EXPIRE", "rl:auto:monitoramento:dia:1", "86400", "NX"]);
});

test("orçamento de saúde é diário e limitado a 120 chamadas", async () => {
  comUpstash();
  delete process.env.RL_SAUDE_DIA;
  const redis = redisMemoria({ "rl:auto:saude:dia:1": 119 });
  await comFetch(redis.fetch, async () => {
    const agora = 86400000 + 1000;
    assert.equal((await consumirSaude(agora)).permitido, true);
    const estourado = await consumirSaude(agora);
    assert.equal(estourado.permitido, false);
    assert.equal(estourado.escopo, "saude_dia");
    assert.equal(estourado.limite, 120);
  });
});

test("orçamento da automação não falha aberto sem Upstash nem com pipeline malformado", async () => {
  semUpstash();
  assert.deepEqual(await consumirMonitoramento(0), { permitido: false, indisponivel: true, motivo: "upstash_nao_configurado" });
  assert.deepEqual(await consumirSaude(0), { permitido: false, indisponivel: true, motivo: "upstash_nao_configurado" });

  comUpstash();
  await comFetch(async () => jsonResponse(200, [{ error: "ERR" }]), async () => {
    assert.equal((await consumirMonitoramento(0)).permitido, false);
    assert.equal((await consumirSaude(0)).permitido, false);
  });
  await comFetch(async () => { throw new Error("redis fora do ar"); }, async () => {
    assert.equal((await consumirMonitoramento(0)).permitido, false);
    assert.equal((await consumirSaude(0)).permitido, false);
  });
});

test("circuito por alias abre na terceira falha consecutiva e expira em 30 minutos", async () => {
  comUpstash();
  const redis = redisMemoria();
  await comFetch(redis.fetch, async () => {
    assert.equal(await automacao.circuitoAberto("api_publica_tjsp"), false);
    await automacao.registrarFalhaCircuito("api_publica_tjsp");
    await automacao.registrarFalhaCircuito("api_publica_tjsp");
    assert.equal(await automacao.circuitoAberto("api_publica_tjsp"), false, "duas falhas ainda não abrem");
    await automacao.registrarFalhaCircuito("api_publica_tjsp");
    assert.equal(await automacao.circuitoAberto("api_publica_tjsp"), true);
    assert.equal(await automacao.circuitoAberto("api_publica_tjrj"), false, "o circuito é por alias");

    await automacao.limparCircuito("api_publica_tjsp");
    assert.equal(await automacao.circuitoAberto("api_publica_tjsp"), false);
  });
  const expira = redis.chamadas.flat().find((comando) => comando[0] === "EXPIRE");
  assert.deepEqual(expira, ["EXPIRE", "cb:datajud:api_publica_tjsp", "1800"]);
});

test("consulta resiliente repete no máximo três vezes em 429 e 5xx, com espera crescente", async () => {
  comUpstash();
  const redis = redisMemoria();
  await comFetch(redis.fetch, async () => {
    for (const codigo of ["cota_excedida", "tribunal_indisponivel"]) {
      redis.contagens.clear();
      const esperas = [];
      let tentativas = 0;
      const erro = await automacao.consultarComResiliencia("00013278820188260344", "api_publica_tjsp", {
        consumirOrcamento: async () => ({ permitido: true }),
        consultar: async () => { tentativas += 1; throw Object.assign(new Error(codigo), { codigo }); },
        esperar: async (ms) => { esperas.push(ms); },
      }).then(() => null, (e) => e);

      assert.equal(tentativas, 3, codigo);
      assert.equal(erro.codigo, codigo);
      assert.deepEqual(esperas, automacao.ATRASOS_RETENTATIVA_MS.slice(0, 2), "espera cresce entre tentativas");
      assert.equal(await automacao.circuitoAberto("api_publica_tjsp"), true, "três falhas seguidas abrem o circuito");
    }
  });
});

test("consulta resiliente não repete erro que não é 429 nem 5xx", async () => {
  comUpstash();
  const redis = redisMemoria();
  await comFetch(redis.fetch, async () => {
    let tentativas = 0;
    const erro = await automacao.consultarComResiliencia("00013278820188260344", "api_publica_tjsp", {
      consumirOrcamento: async () => ({ permitido: true }),
      consultar: async () => { tentativas += 1; throw Object.assign(new Error("alias_inexistente"), { codigo: "alias_inexistente" }); },
      esperar: async () => {},
    }).then(() => null, (e) => e);

    assert.equal(tentativas, 1);
    assert.equal(erro.codigo, "alias_inexistente");
    assert.equal(await automacao.circuitoAberto("api_publica_tjsp"), false, "erro de configuração não conta para o circuito");
  });
});

test("sucesso limpa o circuito e devolve a resposta normalizada", async () => {
  comUpstash();
  const redis = redisMemoria({ "cb:datajud:api_publica_tjsp": 2 });
  await comFetch(redis.fetch, async () => {
    const resposta = await automacao.consultarComResiliencia("00013278820188260344", "api_publica_tjsp", {
      consumirOrcamento: async () => ({ permitido: true }),
      consultar: async () => ({ encontrado: true, total: 1, processos: [] }),
      esperar: async () => {},
    });
    assert.equal(resposta.encontrado, true);
    assert.equal(redis.contagens.has("cb:datajud:api_publica_tjsp"), false, "sucesso zera a contagem de falhas");
  });
});

test("circuito aberto e orçamento negado impedem qualquer chamada ao DataJud", async () => {
  comUpstash();
  const redis = redisMemoria({ "cb:datajud:api_publica_tjsp": 3 });
  await comFetch(redis.fetch, async () => {
    let tentativas = 0;
    const aberto = await automacao.consultarComResiliencia("00013278820188260344", "api_publica_tjsp", {
      consumirOrcamento: async () => ({ permitido: true }),
      consultar: async () => { tentativas += 1; return {}; },
      esperar: async () => {},
    }).then(() => null, (e) => e);
    assert.equal(aberto.codigo, "circuito_aberto");
    assert.equal(tentativas, 0);

    const semOrcamento = await automacao.consultarComResiliencia("00013278820188260344", "api_publica_tjrj", {
      consumirOrcamento: async () => ({ permitido: false, indisponivel: true, motivo: "upstash_nao_configurado" }),
      consultar: async () => { tentativas += 1; return {}; },
      esperar: async () => {},
    }).then(() => null, (e) => e);
    assert.equal(semOrcamento.codigo, "orcamento_excedido");
    assert.equal(tentativas, 0, "orçamento indisponível nunca vira chamada");
  });
});

test("classificação de falha traduz o código do cliente em status e HTTP da medição", () => {
  assert.deepEqual(automacao.classificarFalhaTribunal("cota_excedida"), { status: "degradado", statusCode: 429 });
  assert.deepEqual(automacao.classificarFalhaTribunal("timeout"), { status: "degradado", statusCode: null });
  assert.deepEqual(automacao.classificarFalhaTribunal("tribunal_indisponivel"), { status: "indisponivel", statusCode: 503 });
  assert.deepEqual(automacao.classificarFalhaTribunal("alias_inexistente"), { status: "indisponivel", statusCode: 404 });
  assert.deepEqual(automacao.classificarFalhaTribunal("qualquer_outro"), { status: "indisponivel", statusCode: null });
});

test("digest agrupa alertas do destinatário e escapa valores no HTML", () => {
  const email = automacao.montarEmailDigest([
    { numero: "00013278820188260344", estagio_anterior: "nao_classificado", estagio_atual: "expedicao_alvara" },
    { numero: "00013278820188260345", estagio_anterior: null, estagio_atual: "<script>alerta</script>" },
  ]);

  assert.match(email.assunto, /2/);
  assert.equal(email.html.includes("<script>alerta</script>"), false, "valor remoto não pode virar HTML");
  assert.equal(email.html.includes("&lt;script&gt;"), true);
  assert.equal(email.html.includes("00013278820188260344"), true);
  assert.equal(email.texto.includes("00013278820188260345"), true);
});

test("Resend exige chave e remetente configurados, sem vazá-los no erro", async () => {
  delete process.env.RESEND_API_KEY;
  process.env.RESEND_FROM_EMAIL = "monitoramento@exemplo.test";
  const semChave = await enviarEmail({ para: "pessoa@exemplo.test", assunto: "a", html: "<p>a</p>", texto: "a" }).then(() => null, (e) => e);
  assert.equal(semChave.codigo, "email_indisponivel");

  process.env.RESEND_API_KEY = "chave-secreta-de-teste";
  delete process.env.RESEND_FROM_EMAIL;
  const semRemetente = await enviarEmail({ para: "pessoa@exemplo.test", assunto: "a", html: "<p>a</p>", texto: "a" }).then(() => null, (e) => e);
  assert.equal(semRemetente.codigo, "email_indisponivel");
  assert.equal(String(semRemetente.message).includes("chave-secreta-de-teste"), false);
});

test("Resend envia com Bearer e só considera aceito o status 2xx", async () => {
  process.env.RESEND_API_KEY = "chave-secreta-de-teste";
  process.env.RESEND_FROM_EMAIL = "monitoramento@exemplo.test";
  const chamadas = [];
  const enviado = await enviarEmail(
    { para: "pessoa@exemplo.test", assunto: "Resumo", html: "<p>oi</p>", texto: "oi" },
    async (url, init) => { chamadas.push({ url, init }); return jsonResponse(200, { id: "email-1" }); }
  );

  assert.equal(enviado.id, "email-1");
  assert.equal(chamadas[0].url, "https://api.resend.com/emails");
  assert.equal(chamadas[0].init.headers.Authorization, "Bearer chave-secreta-de-teste");
  const corpo = JSON.parse(chamadas[0].init.body);
  assert.equal(corpo.from, "monitoramento@exemplo.test");
  assert.deepEqual(corpo.to, ["pessoa@exemplo.test"]);
  assert.equal(corpo.subject, "Resumo");

  const recusado = await enviarEmail(
    { para: "pessoa@exemplo.test", assunto: "Resumo", html: "<p>oi</p>", texto: "oi" },
    async () => jsonResponse(422, { message: "invalid" })
  ).then(() => null, (e) => e);
  assert.equal(recusado.codigo, "email_rejeitado");
  assert.equal(recusado.status, 422);
  assert.equal(String(recusado.message).includes("chave-secreta-de-teste"), false);
});
