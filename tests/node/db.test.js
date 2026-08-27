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

const { claimBatchItem, createBatch, finishBatchItem, persistSnapshot, purgeExpired } = await import("../../server/db.js");

function reiniciar(roteiro = []) {
  consultas.length = 0;
  respostas = roteiro;
}

function textos() {
  return consultas.map((consulta) => consulta.texto.replace(/\s+/g, " ").trim());
}

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
