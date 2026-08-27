import assert from "node:assert/strict";
import test from "node:test";

import { lerPlanilhaXlsx, xlsxDeLote } from "../../server/xlsx.js";

test("XLSX exportado pode ser lido sem interpretar fórmulas", () => {
  const xlsx = xlsxDeLote([{ linha: 1, numero: "00013278820188260344", status: "concluido", erro: "", estagio: "expedicao_alvara" }]);
  assert.deepEqual(lerPlanilhaXlsx(xlsx), [
    ["linha", "numero", "status", "erro", "estagio"],
    ["1", "00013278820188260344", "concluido", "", "expedicao_alvara"],
  ]);
});

test("XLSX inválido é rejeitado", () => {
  assert.throws(() => lerPlanilhaXlsx(Buffer.from("não é zip")), /xlsx_invalido/);
});
