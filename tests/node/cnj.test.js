import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function carregarCNJ() {
  const global = {};
  global.window = global;
  global.globalThis = global;
  const context = vm.createContext(global);
  for (const file of ["js/tables.js", "js/cnj.js"]) {
    vm.runInContext(readFileSync(file, "utf8"), context, { filename: file });
  }
  return global.CNJ;
}

test("CNJ normaliza, formata e separa o número único", () => {
  const cnj = carregarCNJ();
  const numero = "0001327-88.2018.8.26.0344";

  assert.equal(cnj.normalize(numero), "00013278820188260344");
  assert.equal(cnj.format("0001327882018826034499"), numero);
  assert.deepEqual({ ...cnj.parse(numero) }, {
    sequencial: "0001327", verificador: "88", ano: "2018", segmento: "8",
    tribunal: "26", origem: "0344", digitos: "00013278820188260344",
  });
  assert.equal(cnj.parse("123"), null);
});

test("CNJ calcula o dígito ISO 7064 e descreve o tribunal", () => {
  const cnj = carregarCNJ();
  const valido = "0010500-52.2019.5.02.0011";

  assert.equal(cnj.digitoEsperado(cnj.parse("0001327-00.2018.8.26.0344")), "88");
  assert.equal(cnj.validate(cnj.parse(valido)), true);
  assert.equal(cnj.validate(cnj.parse("0010500-53.2019.5.02.0011")), false);
  assert.equal(cnj.describe(valido).tribunalNome, "TRT da 2ª Região (SP)");
});

test("suíte legada completa permanece verde", () => {
  const global = {};
  global.window = global;
  global.globalThis = global;
  const context = vm.createContext(global);
  for (const file of ["js/tables.js", "js/cnj.js", "tests/cnj.test.js"]) {
    vm.runInContext(readFileSync(file, "utf8"), context, { filename: file });
  }
  const resultados = global.CNJ_TESTS.runAll();
  const falhas = resultados.filter((item) => !item.ok);
  assert.equal(resultados.length, 34);
  assert.equal(falhas.length, 0, JSON.stringify(falhas));
});
