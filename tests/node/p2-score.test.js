import assert from "node:assert/strict";
import test from "node:test";

import { FONTE_SCORE, VERSAO_REGRAS_SCORE, calcularScore, parseDataProcesso, scoreDaConsulta } from "../../server/p2-score.js";

const AGORA = "2026-09-08T12:00:00.000Z";
const NUMERO_TJSP = "00013278820188260344";

function processo(extra = {}) {
  return Object.assign({
    numeroProcesso: NUMERO_TJSP,
    tribunal: "TJSP",
    grau: "G1",
    dataAjuizamento: "20180514",
    movimentos: [],
  }, extra);
}

function porFator(score, nome) {
  return score.fatores.find((item) => item.fator === nome);
}

test("score sem estágio TPU curado calcula a faixa e declara confiança baixa", () => {
  const score = calcularScore(processo(), AGORA);

  assert.equal(score.confianca, "baixa");
  assert.equal(porFator(score, "estagio_tpu").pontos, 0);
  assert.match(score.ressalva, /Estágio processual desconhecido/);
  assert.match(score.ressalva, /pesos semente pendentes de aprovação da área de risco/);
  // A faixa continua sendo calculada: esconder o resultado é pior que declarar
  // que o estágio é desconhecido.
  assert.ok(["prioridade_alta", "prioridade_media", "prioridade_baixa"].includes(score.faixa));
  assert.equal(score.pontos, porFator(score, "idade_processo").pontos + porFator(score, "grau").pontos + porFator(score, "segmento").pontos);
});

test("toda saída carrega versão, fonte e a marca de não aprovado pela área de risco", () => {
  const score = calcularScore(processo(), AGORA);

  assert.equal(score.versao, VERSAO_REGRAS_SCORE);
  assert.equal(score.fonte, FONTE_SCORE);
  assert.equal(score.aprovadaPorRisco, false);
  assert.equal(typeof score.ressalva, "string");
  assert.ok(score.ressalva.length > 0);
});

test("movimento TPU curado soma o fator jurídico e cita código e data", () => {
  const score = calcularScore(processo({
    movimentos: [{ codigo: 12548, nome: "Expedição de alvará", dataHora: "2026-09-01T10:00:00.000Z" }],
  }), AGORA);

  const estagio = porFator(score, "estagio_tpu");
  assert.equal(estagio.pontos, 40);
  // Regra herdada do estágio: nenhum rótulo sem o movimento e a data que o
  // originaram.
  assert.match(estagio.motivo, /12548/);
  assert.match(estagio.motivo, /2026-09-01/);
  assert.equal(score.confianca, "alta");
  assert.equal(score.faixa, "prioridade_alta");
});

test("cada fator explica a própria pontuação", () => {
  const score = calcularScore(processo({
    movimentos: [{ codigo: 26, nome: "Distribuição", dataHora: "2026-09-05T10:00:00.000Z" }],
  }), AGORA);

  assert.deepEqual(score.fatores.map((item) => item.fator), [
    "estagio_tpu", "idade_processo", "grau", "segmento", "cadencia_movimentos",
  ]);
  for (const item of score.fatores) {
    assert.equal(typeof item.motivo, "string");
    assert.ok(item.motivo.length > 0, item.fator + " precisa de motivo");
    assert.equal(Number.isFinite(item.pontos), true);
  }
  assert.equal(score.pontos, score.fatores.reduce((total, item) => total + item.pontos, 0));
});

test("idade do processo vem do ajuizamento, não da idade do movimento", () => {
  const antigo = calcularScore(processo({ dataAjuizamento: "20180514" }), AGORA);
  const novo = calcularScore(processo({ dataAjuizamento: "2026-06-01T00:00:00.000Z" }), AGORA);

  assert.equal(porFator(antigo, "idade_processo").pontos, 20);
  assert.equal(porFator(novo, "idade_processo").pontos, 2);
  assert.match(porFator(antigo, "idade_processo").motivo, /2018-05-14/);
});

test("sinais ausentes viram fator zerado com motivo, nunca fator omitido", () => {
  const score = calcularScore({ numeroProcesso: "", grau: "", dataAjuizamento: null, movimentos: [] }, AGORA);

  assert.equal(score.pontos, 0);
  assert.equal(score.faixa, "prioridade_baixa");
  assert.equal(score.fatores.length, 5);
  assert.match(porFator(score, "idade_processo").motivo, /ausente/);
  assert.match(porFator(score, "grau").motivo, /não informado/);
  assert.match(porFator(score, "segmento").motivo, /indisponível/);
  assert.match(porFator(score, "cadencia_movimentos").motivo, /Sem movimentos datados/);
});

test("cadência distingue movimentação recente de processo parado", () => {
  const recente = calcularScore(processo({ movimentos: [{ codigo: 26, dataHora: "2026-09-05T00:00:00.000Z" }] }), AGORA);
  const parado = calcularScore(processo({ movimentos: [{ codigo: 26, dataHora: "2022-01-05T00:00:00.000Z" }] }), AGORA);

  assert.equal(porFator(recente, "cadencia_movimentos").pontos, 15);
  assert.equal(porFator(parado, "cadencia_movimentos").pontos, 0);
  assert.match(porFator(parado, "cadencia_movimentos").motivo, /mais de um ano/);
});

test("data de ajuizamento no futuro não vira pontuação", () => {
  const score = calcularScore(processo({ dataAjuizamento: "2030-01-01T00:00:00.000Z" }), AGORA);
  assert.equal(porFator(score, "idade_processo").pontos, 0);
  assert.match(porFator(score, "idade_processo").motivo, /futuro/);
});

test("parseDataProcesso aceita os dois formatos do DataJud e recusa lixo", () => {
  assert.equal(parseDataProcesso("20180514"), Date.parse("2018-05-14T00:00:00Z"));
  assert.equal(parseDataProcesso("20180514093000"), Date.parse("2018-05-14T09:30:00Z"));
  assert.equal(parseDataProcesso("2018-05-14T00:00:00.000Z"), Date.parse("2018-05-14T00:00:00.000Z"));
  assert.equal(parseDataProcesso(""), null);
  assert.equal(parseDataProcesso(null), null);
  assert.equal(parseDataProcesso("não é data"), null);
});

test("score da consulta usa a primeira instância, já ordenada por grau", () => {
  const score = scoreDaConsulta({
    encontrado: true,
    processos: [processo({ grau: "G1" }), processo({ grau: "SUP" })],
  }, AGORA);

  assert.equal(porFator(score, "grau").pontos, 15);
});

test("consulta vazia ainda devolve faixa, confiança e ressalva", () => {
  const score = scoreDaConsulta({ encontrado: false, total: 0, processos: [] }, AGORA);

  assert.equal(score.faixa, "prioridade_baixa");
  assert.equal(score.confianca, "baixa");
  assert.equal(score.aprovadaPorRisco, false);
  assert.equal(score.fatores.length, 5);
});

// O estágio persistido em `snapshots` classifica os movimentos de TODAS as
// instâncias. Se o score olhasse só a primeira, a faixa poderia dizer "nenhum
// movimento curado" ao lado de um estágio classificado.
test("score da consulta considera movimentos de todas as instâncias", () => {
  const score = scoreDaConsulta({
    encontrado: true,
    processos: [
      processo({ grau: "G1", movimentos: [] }),
      processo({ grau: "G2", movimentos: [{ codigo: 12548, nome: "Expedição de alvará", dataHora: "2026-09-01T10:00:00.000Z" }] }),
    ],
  }, AGORA);

  assert.equal(porFator(score, "estagio_tpu").pontos, 40);
  assert.equal(porFator(score, "grau").pontos, 15, "grau e segmento continuam vindo da instância mais relevante");
  assert.equal(score.confianca, "alta");
});
