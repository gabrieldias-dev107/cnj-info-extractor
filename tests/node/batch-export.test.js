import assert from "node:assert/strict";
import test from "node:test";

import { csvDeLote } from "../../server/batch-export.js";

test("exportação CSV escapa texto e neutraliza fórmula de planilha", () => {
  assert.equal(csvDeLote([{ linha: 1, numero: "00013278820188260344", status: "falhou", erro: '=HYPERLINK("x")' }]),
    "linha,numero,status,erro,estagio\r\n1,00013278820188260344,falhou,\"'=HYPERLINK(\"\"x\"\")\",\r\n");
});
