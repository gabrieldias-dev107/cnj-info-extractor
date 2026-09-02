import assert from "node:assert/strict";
import test from "node:test";

import { descricaoMovimento, mudancaRelevante } from "../../server/p1-core.js";

test("glossário não expõe código TPU sem curadoria jurídica", () => {
  assert.equal(descricaoMovimento(99999), null);
});

test("mudança de estágio aprovado é relevante", () => {
  assert.equal(
    mudancaRelevante({ estagio: "nao_classificado" }, { estagio: "expedicao_alvara" }),
    true,
  );
});

test("mudança entre estágios desconhecidos não gera alerta", () => {
  assert.equal(
    mudancaRelevante({ estagio: "desconhecido_a" }, { estagio: "desconhecido_b" }),
    false,
  );
});
