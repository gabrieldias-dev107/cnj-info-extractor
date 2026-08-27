import assert from "node:assert/strict";
import test from "node:test";

import { validarNumeroParaConsulta } from "../../server/cnj-validation.js";
import { numerosDaPlanilha, prepararLote } from "../../server/batch-service.js";

test("validação de lote confirma DV e deriva alias no servidor", () => {
  assert.deepEqual(validarNumeroParaConsulta("0001327-88.2018.8.26.0344"), {
    valido: true,
    numero: "00013278820188260344",
    alias: "api_publica_tjsp",
  });
});

test("validação de lote rejeita DV incorreto e tribunal sem índice DataJud", () => {
  assert.deepEqual(validarNumeroParaConsulta("0001327-89.2018.8.26.0344"), {
    valido: false,
    erro: "digito_verificador_invalido",
  });
  assert.deepEqual(validarNumeroParaConsulta("0000123-27.2020.2.00.0000"), {
    valido: false,
    erro: "alias_desconhecido",
  });
});

test("lote limita 500 linhas, valida no servidor e preserva linha inválida", () => {
  assert.deepEqual(prepararLote(["0001327-88.2018.8.26.0344", "0001327-89.2018.8.26.0344"]), [
    { linha: 1, numero: "00013278820188260344", alias: "api_publica_tjsp", status: "pendente", erro: null },
    { linha: 2, numero: "00013278920188260344", alias: null, status: "invalido", erro: "digito_verificador_invalido" },
  ]);
  assert.throws(() => prepararLote(Array(501).fill("0001327-88.2018.8.26.0344")), /lote_maior_que_500/);
});

test("importação XLSX seleciona a coluna numero do arquivo exportado", () => {
  assert.deepEqual(numerosDaPlanilha([
    ["linha", "numero", "status"],
    ["1", "00013278820188260344", "concluido"],
  ]), ["00013278820188260344"]);
});
