import assert from "node:assert/strict";
import test, { mock } from "node:test";

// node:test recusa remockar o mesmo especificador: há um mock por módulo e
// cada teste troca as implementações guardadas em `estado`.
const estado = {};
const registros = {};

function reiniciar() {
  registros.publicados = [];
  registros.avancados = [];
  registros.medicoes = [];
  registros.alertas = [];
  registros.tentativasEnvio = [];
  registros.emails = [];
  registros.persistidos = [];
  registros.estagiosGravados = [];

  estado.verificarAssinatura = async () => true;
  estado.monitoradosDevidos = async () => [{ id: "monitor-1" }, { id: "monitor-2" }];
  estado.monitorado = async () => ({ id: "monitor-1", process_id: "proc-1", numero: "00013278820188260344", alias: "api_publica_tjsp", intervalo_minutos: 60, estagio_conhecido: "nao_classificado", estagio_conhecido_codigo: null });
  estado.ultimoSnapshot = async () => ({ id: "snap-antigo", estagio: "nao_classificado" });
  estado.persistir = async () => ({ snapshotId: "snap-novo", processId: "proc-1", estagio: { estagio: "expedicao_alvara", codigo: 12548 } });
  estado.probesDevidos = async () => [{ id: "probe-1" }];
  estado.probe = async () => ({ id: "probe-1", alias: "api_publica_tjsp", numero: "00013278820188260344", intervalo_minutos: 60 });
  estado.consultar = async () => ({ encontrado: true, total: 1, processos: [] });
  estado.circuito = async () => false;
  estado.orcamentoMonitoramento = async () => ({ permitido: true });
  estado.orcamentoSaude = async () => ({ permitido: true });
  estado.alertasPendentes = async () => [];
  estado.enviar = async () => ({ id: "email-1" });
}
reiniciar();

mock.module("../../server/queue.js", {
  namedExports: {
    verifyQstash: (...args) => estado.verificarAssinatura(...args),
    publishMonitoredProcess: async (id) => { registros.publicados.push({ fila: "monitoramento", id }); },
    publishHealthProbe: async (id) => { registros.publicados.push({ fila: "saude", id }); },
  },
});

mock.module("../../server/db.js", {
  namedExports: {
    dueMonitoredProcesses: (...args) => estado.monitoradosDevidos(...args),
    monitoredProcessForWorker: (...args) => estado.monitorado(...args),
    advanceMonitoredProcess: async (id) => { registros.avancados.push({ tipo: "monitoramento", id }); },
    dueHealthProbes: (...args) => estado.probesDevidos(...args),
    healthProbeForWorker: (...args) => estado.probe(...args),
    advanceHealthProbe: async (id) => { registros.avancados.push({ tipo: "saude", id }); },
    recordHealthMeasurement: async (medicao) => { registros.medicoes.push(medicao); },
    latestSnapshotForProcess: (...args) => estado.ultimoSnapshot(...args),
    updateMonitoredProcessStage: async (id, estagio) => { registros.estagiosGravados.push({ id, ...estagio }); },
    persistSnapshot: async (dados) => { registros.persistidos.push(dados); return estado.persistir(dados); },
    createPendingAlerts: async (alerta) => { registros.alertas.push(alerta); return [{ id: "alerta-1" }]; },
    undeliveredAlerts: (...args) => estado.alertasPendentes(...args),
    recordAlertSendAttempt: async (id, dados) => { registros.tentativasEnvio.push({ id, ...dados }); },
  },
});

mock.module("../../server/p1-automation.js", {
  namedExports: {
    consultarComResiliencia: (numero, alias, opcoes) => estado.consultar(numero, alias, opcoes),
    circuitoAberto: (...args) => estado.circuito(...args),
    registrarFalhaCircuito: async () => {},
    limparCircuito: async () => {},
    classificarFalhaTribunal: (codigo) => (codigo === "cota_excedida" ? { status: "degradado", statusCode: 429 } : { status: "indisponivel", statusCode: 503 }),
    montarEmailDigest: (alertas) => ({ assunto: "Resumo diário", html: "<p>" + alertas.length + "</p>", texto: String(alertas.length) }),
  },
});

mock.module("../../server/rate-limit.js", {
  namedExports: {
    consumirMonitoramento: (...args) => estado.orcamentoMonitoramento(...args),
    consumirSaude: (...args) => estado.orcamentoSaude(...args),
  },
});

mock.module("../../server/resend.js", {
  namedExports: {
    enviarEmail: async (mensagem) => { registros.emails.push(mensagem); return estado.enviar(mensagem); },
  },
});

const { default: monitorTick } = await import("../../api/monitor-worker.js");
const { default: monitorItem } = await import("../../api/monitor-item-worker.js");
const { default: saudeTick } = await import("../../api/health-worker.js");
const { default: saudeItem } = await import("../../api/health-item-worker.js");
const { default: digest } = await import("../../api/digest-worker.js");

function resposta() {
  return {
    statusCode: null,
    body: undefined,
    status(codigo) { this.statusCode = codigo; return this; },
    json(valor) { this.body = valor; return this; },
    end() { return this; },
  };
}

function requisicao(corpo = "{}", { method = "POST", url = "/api/worker" } = {}) {
  const stream = (async function* () { if (corpo) yield Buffer.from(corpo); })();
  stream.method = method;
  stream.headers = { "upstash-signature": "assinatura" };
  stream.url = url;
  return stream;
}

const WORKERS = [
  ["monitor-worker", monitorTick, "{}"],
  ["monitor-item-worker", monitorItem, '{"monitoredProcessId":"monitor-1"}'],
  ["health-worker", saudeTick, "{}"],
  ["health-item-worker", saudeItem, '{"healthProbeId":"probe-1"}'],
  ["digest-worker", digest, "{}"],
];

test("todo worker recusa assinatura QStash inválida antes de qualquer efeito", async () => {
  for (const [nome, handler, corpo] of WORKERS) {
    reiniciar();
    estado.verificarAssinatura = async () => false;
    const res = resposta();
    await handler(requisicao(corpo), res);
    assert.equal(res.statusCode, 401, nome);
    assert.deepEqual(res.body, { error: "assinatura_invalida" }, nome);
    assert.deepEqual(registros.publicados, [], nome);
    assert.deepEqual(registros.persistidos, [], nome);
    assert.deepEqual(registros.medicoes, [], nome);
    assert.deepEqual(registros.emails, [], nome);
  }
});

test("assinatura é verificada sobre o corpo bruto recebido", async () => {
  reiniciar();
  const vistos = [];
  estado.verificarAssinatura = async (_req, corpo) => { vistos.push(corpo); return true; };
  await monitorTick(requisicao('{"origem":"cron"}'), resposta());
  assert.deepEqual(vistos, ['{"origem":"cron"}']);
});

test("tick de monitoramento publica cada item devido e adia a próxima consulta", async () => {
  reiniciar();
  const res = resposta();
  await monitorTick(requisicao(), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { publicados: 2, falhas: 0 });
  assert.deepEqual(registros.publicados, [
    { fila: "monitoramento", id: "monitor-1" },
    { fila: "monitoramento", id: "monitor-2" },
  ]);
  assert.deepEqual(registros.avancados, [
    { tipo: "monitoramento", id: "monitor-1" },
    { tipo: "monitoramento", id: "monitor-2" },
  ]);
});

test("tick de saúde publica cada probe devido", async () => {
  reiniciar();
  const res = resposta();
  await saudeTick(requisicao(), res);
  assert.deepEqual(registros.publicados, [{ fila: "saude", id: "probe-1" }]);
  assert.deepEqual(registros.avancados, [{ tipo: "saude", id: "probe-1" }]);
  assert.equal(res.statusCode, 200);
});

test("mudança relevante de estágio cria um alerta pendente por destinatário", async () => {
  reiniciar();
  const res = resposta();
  await monitorItem(requisicao('{"monitoredProcessId":"monitor-1"}'), res);

  assert.equal(res.statusCode, 204);
  assert.equal(registros.persistidos.length, 1);
  assert.deepEqual(registros.alertas, [{
    monitoredProcessId: "monitor-1",
    snapshotAnteriorId: "snap-antigo",
    snapshotAtualId: "snap-novo",
    estagioAnterior: "nao_classificado",
    estagioAtual: "expedicao_alvara",
  }]);
  assert.deepEqual(registros.estagiosGravados, [{ id: "monitor-1", estagio: "expedicao_alvara", codigo: 12548 }]);
});

// Regressão do achado da revisão: `processes`/`snapshots` são globais por
// número, então uma consulta manual ou outro portfólio podia consumir a
// transição antes deste item e o alerta nunca sair.
test("transição já registrada por outro portfólio ainda alerta este item", async () => {
  reiniciar();
  // O snapshot compartilhado já está no estágio novo; o que este item conhece
  // continua sendo o antigo.
  estado.ultimoSnapshot = async () => ({ id: "snap-antigo", estagio: "expedicao_alvara" });
  const res = resposta();
  await monitorItem(requisicao('{"monitoredProcessId":"monitor-1"}'), res);

  assert.equal(res.statusCode, 204);
  assert.equal(registros.alertas.length, 1, "a comparação é por item monitorado, não pelo snapshot compartilhado");
  assert.equal(registros.alertas[0].estagioAnterior, "nao_classificado");
});

test("item já ciente do estágio não alerta de novo, mas o estágio conhecido é sempre gravado", async () => {
  reiniciar();
  estado.monitorado = async () => ({ id: "monitor-1", process_id: "proc-1", numero: "00013278820188260344", alias: "api_publica_tjsp", intervalo_minutos: 60, estagio_conhecido: "expedicao_alvara", estagio_conhecido_codigo: 12548 });
  const res = resposta();
  await monitorItem(requisicao('{"monitoredProcessId":"monitor-1"}'), res);

  assert.deepEqual(registros.alertas, []);
  assert.deepEqual(registros.estagiosGravados, [{ id: "monitor-1", estagio: "expedicao_alvara", codigo: 12548 }]);
});

test("estágio sem transição aprovada persiste o snapshot mas não gera alerta", async () => {
  reiniciar();
  estado.ultimoSnapshot = async () => ({ id: "snap-antigo", estagio: "nao_classificado" });
  estado.persistir = async () => ({ snapshotId: "snap-novo", processId: "proc-1", estagio: { estagio: "nao_classificado", codigo: null } });
  const res = resposta();
  await monitorItem(requisicao('{"monitoredProcessId":"monitor-1"}'), res);

  assert.equal(res.statusCode, 204);
  assert.equal(registros.persistidos.length, 1);
  assert.deepEqual(registros.alertas, [], "repetir o mesmo estágio não alerta");
  assert.deepEqual(registros.estagiosGravados, [{ id: "monitor-1", estagio: "nao_classificado", codigo: null }]);
});

test("orçamento de monitoramento negado bloqueia a consulta ao DataJud", async () => {
  reiniciar();
  let consultou = 0;
  estado.orcamentoMonitoramento = async () => ({ permitido: false, indisponivel: true, motivo: "upstash_nao_configurado" });
  estado.consultar = async (numero, alias, opcoes) => {
    const orcamento = await opcoes.consumirOrcamento();
    if (!orcamento.permitido) throw Object.assign(new Error("orcamento_excedido"), { codigo: "orcamento_excedido" });
    consultou += 1;
    return {};
  };
  const res = resposta();
  await monitorItem(requisicao('{"monitoredProcessId":"monitor-1"}'), res);

  assert.equal(consultou, 0);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: "orcamento_excedido" });
  assert.deepEqual(registros.persistidos, []);
});

test("circuito aberto responde 503 sem persistir snapshot", async () => {
  reiniciar();
  estado.consultar = async () => { throw Object.assign(new Error("circuito_aberto"), { codigo: "circuito_aberto" }); };
  const res = resposta();
  await monitorItem(requisicao('{"monitoredProcessId":"monitor-1"}'), res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "circuito_aberto" });
  assert.deepEqual(registros.persistidos, []);
});

test("item monitorado inexistente ou expirado encerra sem trabalho", async () => {
  reiniciar();
  estado.monitorado = async () => null;
  const res = resposta();
  await monitorItem(requisicao('{"monitoredProcessId":"monitor-1"}'), res);
  assert.equal(res.statusCode, 204);
  assert.deepEqual(registros.persistidos, []);
});

test("medição de saúde registra status, código HTTP e duração", async () => {
  reiniciar();
  const res = resposta();
  await saudeItem(requisicao('{"healthProbeId":"probe-1"}'), res);

  assert.equal(res.statusCode, 204);
  assert.equal(registros.medicoes.length, 1);
  const medicao = registros.medicoes[0];
  assert.equal(medicao.healthProbeId, "probe-1");
  assert.equal(medicao.status, "disponivel");
  assert.equal(medicao.statusCode, 200);
  assert.equal(Number.isFinite(medicao.duracaoMs), true);
});

test("falha do tribunal vira medição degradada sem derrubar o worker", async () => {
  reiniciar();
  estado.consultar = async () => { throw Object.assign(new Error("cota_excedida"), { codigo: "cota_excedida" }); };
  const res = resposta();
  await saudeItem(requisicao('{"healthProbeId":"probe-1"}'), res);

  assert.equal(res.statusCode, 204);
  assert.deepEqual(registros.medicoes.map((medicao) => [medicao.status, medicao.statusCode]), [["degradado", 429]]);
});

test("circuito aberto registra medição própria sem consultar o tribunal", async () => {
  reiniciar();
  let consultou = 0;
  estado.circuito = async () => true;
  estado.consultar = async () => { consultou += 1; return {}; };
  const res = resposta();
  await saudeItem(requisicao('{"healthProbeId":"probe-1"}'), res);

  assert.equal(consultou, 0);
  assert.deepEqual(registros.medicoes.map((medicao) => medicao.status), ["circuito_aberto"]);
});

test("medição usa o número e o alias gravados no próprio probe", async () => {
  reiniciar();
  const consultados = [];
  estado.consultar = async (numero, alias) => { consultados.push([numero, alias]); return { encontrado: true, processos: [] }; };
  const res = resposta();
  await saudeItem(requisicao('{"healthProbeId":"probe-1"}'), res);

  assert.deepEqual(consultados, [["00013278820188260344", "api_publica_tjsp"]]);
  assert.equal(res.statusCode, 204);
});

test("digest envia um e-mail por destinatário e só marca enviado após aceite do Resend", async () => {
  reiniciar();
  estado.alertasPendentes = async () => [
    { id: "alerta-1", recipient_user_id: "user-1", email: "um@exemplo.test", numero: "00013278820188260344", estagio_anterior: null, estagio_atual: "expedicao_alvara" },
    { id: "alerta-2", recipient_user_id: "user-1", email: "um@exemplo.test", numero: "00013278820188260345", estagio_anterior: "nao_classificado", estagio_atual: "expedicao_alvara" },
    { id: "alerta-3", recipient_user_id: "user-2", email: "dois@exemplo.test", numero: "00013278820188260346", estagio_anterior: null, estagio_atual: "expedicao_alvara" },
  ];
  const res = resposta();
  await digest(requisicao(), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { destinatarios: 2, enviados: 3, falhas: 0 });
  assert.deepEqual(registros.emails.map((email) => email.para), ["um@exemplo.test", "dois@exemplo.test"]);
  assert.deepEqual(registros.tentativasEnvio, [
    { id: "alerta-1", status: "enviado", erro: null },
    { id: "alerta-2", status: "enviado", erro: null },
    { id: "alerta-3", status: "enviado", erro: null },
  ]);
});

test("recusa do Resend não marca alerta como enviado e não contamina outro destinatário", async () => {
  reiniciar();
  estado.alertasPendentes = async () => [
    { id: "alerta-1", recipient_user_id: "user-1", email: "um@exemplo.test", numero: "00013278820188260344", estagio_anterior: null, estagio_atual: "expedicao_alvara" },
    { id: "alerta-3", recipient_user_id: "user-2", email: "dois@exemplo.test", numero: "00013278820188260346", estagio_anterior: null, estagio_atual: "expedicao_alvara" },
  ];
  estado.enviar = async (mensagem) => {
    if (mensagem.para === "um@exemplo.test") throw Object.assign(new Error("email_rejeitado"), { codigo: "email_rejeitado" });
    return { id: "email-2" };
  };
  const res = resposta();
  await digest(requisicao(), res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "digest_parcial", destinatarios: 2, enviados: 1, falhas: 1 });
  assert.deepEqual(registros.tentativasEnvio, [
    { id: "alerta-1", status: "falhou", erro: "email_rejeitado" },
    { id: "alerta-3", status: "enviado", erro: null },
  ]);
});

test("digest sem alerta pendente não chama o Resend", async () => {
  reiniciar();
  const res = resposta();
  await digest(requisicao(), res);
  assert.equal(res.statusCode, 204);
  assert.deepEqual(registros.emails, []);
  assert.deepEqual(registros.tentativasEnvio, []);
});

test("workers só aceitam POST", async () => {
  for (const [nome, handler, corpo] of WORKERS) {
    reiniciar();
    const res = resposta();
    await handler(requisicao(corpo, { method: "GET" }), res);
    assert.equal(res.statusCode, 405, nome);
  }
});

test("corpo sem identificador é rejeitado antes de tocar o banco", async () => {
  reiniciar();
  let buscou = 0;
  estado.monitorado = async () => { buscou += 1; return null; };
  const res = resposta();
  await monitorItem(requisicao('{"outro":1}'), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "item_invalido" });
  assert.equal(buscou, 0);
});
