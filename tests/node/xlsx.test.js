import assert from "node:assert/strict";
import test from "node:test";

import { lerPlanilhaXlsx, xlsxDeLote } from "../../server/xlsx.js";
import { COLUNAS_LOTE } from "../../server/batch-export.js";
import { RESSALVA_EXPORTACAO } from "../../server/p2-score.js";

test("XLSX exportado pode ser lido sem interpretar fórmulas", () => {
  const xlsx = xlsxDeLote([{ linha: 1, numero: "00013278820188260344", status: "concluido", erro: "", estagio: "expedicao_alvara", score_faixa: "prioridade_alta", score_confianca: "alta", score_versao: "score-2026-09-08-semente-1" }]);
  assert.deepEqual(lerPlanilhaXlsx(xlsx), [
    COLUNAS_LOTE,
    ["1", "00013278820188260344", "concluido", "", "expedicao_alvara", "prioridade_alta", "alta", "score-2026-09-08-semente-1", RESSALVA_EXPORTACAO],
  ]);
});

// CSV e XLSX vinham de listas de colunas separadas; divergir era questão de
// tempo. Hoje as duas saem do mesmo módulo.
test("XLSX e CSV compartilham exatamente as mesmas colunas", () => {
  const [cabecalho] = lerPlanilhaXlsx(xlsxDeLote([]));
  assert.deepEqual(cabecalho, COLUNAS_LOTE);
});

test("XLSX inválido é rejeitado", () => {
  assert.throws(() => lerPlanilhaXlsx(Buffer.from("não é zip")), /xlsx_invalido/);
});
