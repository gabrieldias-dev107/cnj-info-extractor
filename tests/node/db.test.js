import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { VERSAO_TPU } from "../../server/p0-core.js";

process.env.DATABASE_URL = "postgres://exemplo/neon";

// O cliente Neon é substituído por um fake que registra as consultas e devolve
// linhas roteirizadas. Assim dá para cobrir a lógica de estado (roll-up do
// lote, reivindicação com limite de tentativas, TTL do snapshot) sem banco.
const consultas = [];
let respostas = [];

// Replica a regra do driver v1: chamar sql(...)/tx(...) como função comum é
// erro; com placeholders só vale .query(). Um fake permissivo aqui esconderia
// exatamente o bug que derrubava createBatch contra o Neon real.
function registrar(texto, parametros = []) {
  consultas.push({ texto, parametros });
  const proxima = respostas.shift();
  return proxima === undefined ? [] : proxima;
}

function taggedOuErro() {
  const alvo = function (textoOuPartes) {
    if (!Array.isArray(textoOuPartes)) {
      throw new Error("This function can now be called only as a tagged-template function");
    }
    return registrar(textoOuPartes.join("?"));
  };
  alvo.query = async (texto, parametros) => registrar(texto, parametros);
  return alvo;
}

function neonFake() {
  const cliente = taggedOuErro();
  cliente.transaction = async (montar) => {
    const passos = typeof montar === "function" ? montar(taggedOuErro()) : montar;
    return Promise.all(passos);
  };
  return cliente;
}

mock.module("@neondatabase/serverless", { namedExports: { neon: () => neonFake() } });

const db = await import("../../server/db.js");
const { claimBatchItem, createBatch, finishBatchItem, freshSnapshot, persistSnapshot, purgeExpired } = db;

function reiniciar(roteiro = []) {
  consultas.length = 0;
  respostas = roteiro;
}

function textos() {
  return consultas.map((consulta) => consulta.texto.replace(/\s+/g, " ").trim());
}

// Regressão do BUG-5 e do BUG-6: o SELECT antigo trazia só `dados`, então a
// classificação TPU sumia da resposta de cache e o worker de lote não tinha o
// id do snapshot para reaproveitar.
test("freshSnapshot devolve id, process_id e o estágio montado das colunas", async () => {
  reiniciar([[{
    id: "snap-1",
    process_id: "proc-1",
    dados: { encontrado: true, total: 1, processos: [] },
    estagio: "expedicao_alvara",
    estagio_codigo: 12548,
    estagio_data: "2026-08-01T00:00:00.000Z",
    tpu_versao: VERSAO_TPU,
  }]]);

  const snap = await freshSnapshot("00013278820188260344");

  const texto = textos()[0];
  for (const coluna of ["s.id", "s.process_id", "s.estagio", "s.estagio_codigo", "s.estagio_data", "s.tpu_versao"]) {
    assert.equal(texto.includes(coluna), true, "SELECT precisa trazer " + coluna);
  }
  assert.equal(snap.id, "snap-1");
  assert.equal(snap.processId, "proc-1");
  assert.deepEqual(snap.dados, { encontrado: true, total: 1, processos: [] });
  assert.equal(snap.estagio.estagio, "expedicao_alvara");
  assert.equal(snap.estagio.codigo, 12548);
  assert.equal(snap.estagio.data, "2026-08-01T00:00:00.000Z");
  assert.equal(snap.estagio.versao, VERSAO_TPU);
  assert.equal(Number.isInteger(snap.estagio.idadeDias), true, "idadeDias é derivado da data, não coluna");
});

test("freshSnapshot sem estágio datado não inventa idadeDias", async () => {
  reiniciar([[{ id: "s", process_id: "p", dados: {}, estagio: "nao_classificado", estagio_codigo: null, estagio_data: null, tpu_versao: VERSAO_TPU }]]);
  const snap = await freshSnapshot("00013278820188260344");
  assert.deepEqual(snap.estagio, { estagio: "nao_classificado", codigo: null, data: null, idadeDias: null, versao: VERSAO_TPU });
});

test("freshSnapshot sem linha devolve null", async () => {
  reiniciar([[]]);
  assert.equal(await freshSnapshot("00013278820188260344"), null);
});

test("finishBatchItem recalcula o status do lote a partir dos itens", async () => {
  reiniciar([[{ batch_id: "lote-1" }], []]);
  await finishBatchItem("item-1", { status: "concluido", snapshotId: "snap-1" });

  assert.equal(consultas.length, 2);
  assert.deepEqual(consultas[0].parametros, ["item-1", "concluido", null, "snap-1"]);
  const rollup = textos()[1];
  // A ordem dos ramos importa: pendente/processando vence falhou, que vence concluido.
  assert.match(rollup, /UPDATE batches SET status=CASE WHEN EXISTS .*'pendente','processando'.* THEN 'processando'/);
  assert.match(rollup, /THEN 'falhou' ELSE 'concluido' END/);
  assert.deepEqual(consultas[1].parametros, ["lote-1"]);
});

test("finishBatchItem de item inexistente não mexe no lote", async () => {
  reiniciar([[]]);
  await finishBatchItem("item-fantasma", { status: "falhou", erro: "seja_o_que_for" });
  assert.equal(consultas.length, 1);
});

test("claimBatchItem só reivindica item retomável e abaixo do limite de tentativas", async () => {
  reiniciar([[{ id: "item-1", batch_id: "lote-1", numero: "0001", alias: "api_publica_tjsp", tentativas: 1 }], []]);
  const item = await claimBatchItem("item-1");

  assert.equal(item.id, "item-1");
  const claim = textos()[0];
  assert.match(claim, /status='processando',tentativas=tentativas\+1/);
  assert.match(claim, /status IN \('pendente','falhou'\)/);
  assert.match(claim, /tentativas < 3/);
  // Reivindicar também move o lote para "processando".
  assert.match(textos()[1], /UPDATE batches SET status='processando'/);
});

test("claimBatchItem devolve null quando outra tentativa já pegou o item", async () => {
  reiniciar([[]]);
  assert.equal(await claimBatchItem("item-1"), null);
  assert.equal(consultas.length, 1, "não pode tocar no lote se nada foi reivindicado");
});

test("persistSnapshot classifica pelo código TPU e deriva a expiração do estágio", async () => {
  reiniciar([[{ id: "proc-1" }], [], [], []]);
  const dados = {
    encontrado: true,
    processos: [{ movimentos: [
      { codigo: 26, nome: "Distribuição", dataHora: "2026-01-02T10:00:00.000Z" },
      { codigo: 12548, nome: "Expedição de alvará", dataHora: "2026-08-20T10:00:00.000Z" },
    ] }],
  };
  const salvo = await persistSnapshot({ numero: "00013278820188260344", alias: "api_publica_tjsp", dados });

  assert.equal(salvo.estagio.estagio, "expedicao_alvara");
  assert.equal(salvo.estagio.codigo, 12548);
  assert.equal(salvo.estagio.versao, VERSAO_TPU);

  const insercaoSnapshot = consultas[1];
  assert.match(insercaoSnapshot.texto, /INSERT INTO snapshots/);
  assert.equal(insercaoSnapshot.parametros[3], "expedicao_alvara");
  assert.equal(insercaoSnapshot.parametros[4], 12548);
  assert.equal(insercaoSnapshot.parametros[6], VERSAO_TPU);
  // TTL de expedicao_alvara é 24h.
  const consultadoEm = insercaoSnapshot.parametros[7];
  const expiraEm = insercaoSnapshot.parametros[8];
  assert.equal(expiraEm.getTime() - consultadoEm.getTime(), 24 * 60 * 60 * 1000);

  // Cada movimento vira uma linha, inclusive os que não classificam nada.
  assert.equal(textos().filter((texto) => texto.startsWith("INSERT INTO movements")).length, 2);
});

test("processo sem código curado fica nao_classificado com TTL padrão de 7 dias", async () => {
  reiniciar([[{ id: "proc-1" }], []]);
  const salvo = await persistSnapshot({
    numero: "00013278820188260344",
    alias: "api_publica_tjsp",
    dados: { encontrado: false, processos: [] },
  });

  assert.equal(salvo.estagio.estagio, "nao_classificado");
  assert.equal(salvo.estagio.codigo, null);
  const insercao = consultas[1];
  assert.equal(insercao.parametros[8].getTime() - insercao.parametros[7].getTime(), 7 * 24 * 60 * 60 * 1000);
});

test("purgeExpired apaga sessões, lotes, snapshots e usuários vencidos", async () => {
  reiniciar([[], [], [], []]);
  await purgeExpired();
  assert.deepEqual(textos(), [
    "DELETE FROM sessions WHERE expires_at <= now()",
    "DELETE FROM batches WHERE expires_at <= now()",
    "DELETE FROM snapshots WHERE consultado_em < now() - interval '180 days'",
    "DELETE FROM users WHERE last_login_at < now() - interval '180 days'",
  ]);
});

test("createBatch grava lote e itens numa transação, usando tx.query", async () => {
  reiniciar([[], [], [{ id: "item-1", linha: 1, numero: "00013278820188260344", alias: "api_publica_tjsp", status: "pendente", erro: null }]]);
  const lote = await createBatch("user-1", [
    { linha: 1, numero: "00013278820188260344", alias: "api_publica_tjsp", status: "pendente", erro: null },
  ]);

  assert.ok(lote.id);
  assert.equal(lote.itens.length, 1);
  const escritos = textos();
  assert.match(escritos[0], /^INSERT INTO batches/);
  assert.match(escritos[1], /^INSERT INTO batch_items/);
  assert.match(escritos[2], /^SELECT id,linha,numero,alias,status,erro FROM batch_items/);
  // O lote nasce "pendente" só se houver item para a fila.
  assert.equal(consultas[0].parametros[2], "pendente");
  assert.equal(consultas[0].parametros[3], 1);
});

test("lote sem nenhum item pendente já nasce concluído", async () => {
  reiniciar([[], [], []]);
  await createBatch("user-1", [
    { linha: 1, numero: "123", alias: null, status: "invalido", erro: "numero_invalido" },
  ]);
  assert.equal(consultas[0].parametros[2], "concluido");
});

test("funções P1 de portfólio existem para isolar leitura de membro e mutação de criador", async () => {
  for (const nome of [
    "createPortfolio", "portfoliosForUser", "portfolioForUser", "updatePortfolioForCreator", "deletePortfolioForCreator",
    "portfolioItemsForUser", "createPortfolioItem", "updatePortfolioItemForCreator", "deletePortfolioItemForCreator",
    "portfolioMembersForUser", "addPortfolioMemberForCreator", "deletePortfolioMemberForCreator",
  ]) {
    assert.equal(typeof db[nome], "function", "db." + nome + " precisa existir");
  }
});

test("portfolioForUser usa escopo de criador ou membro ativo e nunca concatena identificadores", async () => {
  assert.equal(typeof db.portfolioForUser, "function", "db.portfolioForUser precisa existir");
  reiniciar([[{ id: "portfolio-1", nome: "Alfa", papel: "membro" }]]);

  const portfolio = await db.portfolioForUser("portfolio-1", "user-2");

  assert.deepEqual(portfolio, { id: "portfolio-1", nome: "Alfa", papel: "membro" });
  const consulta = textos()[0];
  assert.match(consulta, /FROM portfolios p/);
  assert.match(consulta, /portfolio_members pm/);
  assert.match(consulta, /p\.creator_user_id=\$2/);
  assert.match(consulta, /pm\.user_id=\$2/);
  assert.match(consulta, /p\.expires_at > now\(\)/);
  assert.match(consulta, /pm\.expires_at > now\(\)/);
  assert.deepEqual(consultas[0].parametros, ["portfolio-1", "user-2"]);
});

test("mutação de portfólio filtra o criador no próprio UPDATE parametrizado", async () => {
  assert.equal(typeof db.updatePortfolioForCreator, "function", "db.updatePortfolioForCreator precisa existir");
  reiniciar([[{ id: "portfolio-1", nome: "Novo nome", papel: "criador" }]]);

  const atualizado = await db.updatePortfolioForCreator("portfolio-1", "user-1", { nome: "Novo nome" });

  assert.equal(atualizado.nome, "Novo nome");
  const consulta = textos()[0];
  assert.match(consulta, /UPDATE portfolios SET nome=\$3,updated_at=now\(\)/);
  assert.match(consulta, /WHERE id=\$1 AND creator_user_id=\$2 AND expires_at > now\(\)/);
  assert.deepEqual(consultas[0].parametros, ["portfolio-1", "user-1", "Novo nome"]);
});

test("histórico exige item acessível do portfólio e seleciona somente colunas seguras de snapshot", async () => {
  assert.equal(typeof db.processHistoryForUser, "function", "db.processHistoryForUser precisa existir");
  reiniciar([
    [{ id: "monitor-1" }],
    [{ id: "snap-1", consultado_em: "2026-09-01T10:00:00.000Z", estagio: "expedicao_alvara", estagio_codigo: 12548, estagio_data: "2026-09-01T09:00:00.000Z", tpu_versao: VERSAO_TPU }],
  ]);

  const historico = await db.processHistoryForUser("00013278820188260344", "user-2");

  assert.equal(historico.snapshots.length, 1);
  assert.match(textos()[0], /monitored_processes mp/);
  assert.match(textos()[0], /portfolio_members pm/);
  assert.match(textos()[0], /p\.numero=\$1/);
  assert.match(textos()[0], /po\.creator_user_id=\$2/);
  assert.deepEqual(consultas[0].parametros, ["00013278820188260344", "user-2"]);
  assert.match(textos()[1], /SELECT s\.id,s\.consultado_em,s\.estagio,s\.estagio_codigo,s\.estagio_data,s\.tpu_versao/);
  assert.equal(textos()[1].includes("s.dados"), false, "o histórico não deve trazer o payload bruto do DataJud");
  assert.deepEqual(consultas[1].parametros, ["monitor-1"]);
});

test("health probe é inserido apenas por criador e com valores parametrizados", async () => {
  assert.equal(typeof db.createHealthProbe, "function", "db.createHealthProbe precisa existir");
  reiniciar([[{ id: "probe-1", alias: "api_publica_tjsp", intervalo_minutos: 60 }]]);

  const probe = await db.createHealthProbe("portfolio-1", "user-1", { alias: "api_publica_tjsp", intervaloMinutos: 60 });

  assert.equal(probe.id, "probe-1");
  const consulta = textos()[0];
  assert.match(consulta, /INSERT INTO health_probes/);
  assert.match(consulta, /SELECT \$1,\$2,\$4,\$5,\$6,\$7 FROM portfolios/);
  assert.match(consulta, /WHERE id=\$2 AND creator_user_id=\$3 AND expires_at > now\(\)/);
  assert.equal(consultas[0].parametros[1], "portfolio-1");
  assert.equal(consultas[0].parametros[2], "user-1");
  assert.equal(consultas[0].parametros[3], "api_publica_tjsp");
  assert.equal(consultas[0].parametros[4], 60);
});
