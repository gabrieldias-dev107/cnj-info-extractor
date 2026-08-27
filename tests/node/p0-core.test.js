import assert from "node:assert/strict";
import test from "node:test";

import { classificarEstagio, idadeEmDias, validarLote, ttlPorEstagio } from "../../server/p0-core.js";

test("classificação usa apenas códigos TPU mapeados e preserva o movimento-base", () => {
  const resultado = classificarEstagio([
    { codigo: 999999, nome: "texto parecido", dataHora: "2026-08-01T10:00:00Z" },
    { codigo: 12548, nome: "Expedição de Alvará de Levantamento", dataHora: "2026-08-02T10:00:00Z" },
  ], "2026-08-03T10:00:00Z");

  assert.deepEqual(resultado, {
    estagio: "expedicao_alvara",
    codigo: 12548,
    data: "2026-08-02T10:00:00Z",
    idadeDias: 1,
    versao: "tpu-2026-04-09-semente-1",
  });
});

test("classificação desconhecida não infere estágio pelo nome", () => {
  assert.deepEqual(classificarEstagio([{ codigo: 10, nome: "Penhora", dataHora: "2026-08-02T10:00:00Z" }]), {
    estagio: "nao_classificado",
    codigo: null,
    data: null,
    idadeDias: null,
    versao: "tpu-2026-04-09-semente-1",
  });
});

test("TTL usa maior frescor para alvará e penhora", () => {
  assert.equal(ttlPorEstagio("expedicao_alvara"), 24 * 60 * 60 * 1000);
  assert.equal(ttlPorEstagio("penhora"), 24 * 60 * 60 * 1000);
  assert.equal(ttlPorEstagio("execucao"), 3 * 24 * 60 * 60 * 1000);
  assert.equal(ttlPorEstagio("nao_classificado"), 7 * 24 * 60 * 60 * 1000);
});

test("lote preserva a linha inválida e marca duplicidade sem enfileirar", () => {
  const itens = validarLote([
    "0001327-88.2018.8.26.0344",
    "0001327-88.2018.8.26.0344",
    "123",
  ], (numero) => numero.length === 20 ? { valido: true, alias: "api_publica_tjsp" } : { valido: false, erro: "numero_invalido" });

  assert.deepEqual(itens, [
    { linha: 1, numero: "00013278820188260344", alias: "api_publica_tjsp", status: "pendente", erro: null },
    { linha: 2, numero: "00013278820188260344", alias: "api_publica_tjsp", status: "duplicado", erro: "duplicado" },
    { linha: 3, numero: "123", alias: null, status: "invalido", erro: "numero_invalido" },
  ]);
});

test("idadeEmDias deriva a idade e trata data ausente ou futura", () => {
  const agora = "2026-08-27T12:00:00.000Z";
  assert.equal(idadeEmDias("2026-08-20T12:00:00.000Z", agora), 7);
  assert.equal(idadeEmDias("2026-08-27T00:00:00.000Z", agora), 0);
  assert.equal(idadeEmDias("2026-09-10T12:00:00.000Z", agora), 0, "data futura não vira idade negativa");
  assert.equal(idadeEmDias(null, agora), null);
  assert.equal(idadeEmDias("nao-e-data", agora), null);
});
