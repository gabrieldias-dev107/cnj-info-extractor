import assert from "node:assert/strict";
import test from "node:test";

import { COLUNAS_LOTE, csvDeLote } from "../../server/batch-export.js";
import { RESSALVA_EXPORTACAO } from "../../server/p2-score.js";

test("exportação CSV escapa texto e neutraliza fórmula de planilha", () => {
  assert.equal(csvDeLote([{ linha: 1, numero: "00013278820188260344", status: "falhou", erro: '=HYPERLINK("x")' }]),
    "linha,numero,status,erro,estagio,score_faixa,score_confianca,score_versao,score_ressalva\r\n1,00013278820188260344,falhou,\"'=HYPERLINK(\"\"x\"\")\",,,,,\r\n");
});

// A planilha sai da ferramenta e circula sem a tela que explica a faixa. Onde
// existe faixa, existe ressalva na mesma linha.
test("linha com faixa carrega a ressalva; linha sem faixa não inventa uma", () => {
  const csv = csvDeLote([
    { linha: 1, numero: "00013278820188260344", status: "concluido", erro: "", estagio: "expedicao_alvara", score_faixa: "prioridade_alta", score_confianca: "alta", score_versao: "score-2026-09-08-semente-1" },
    { linha: 2, numero: "00013278820188260344", status: "invalido", erro: "duplicado", estagio: null, score_faixa: null, score_confianca: null, score_versao: null },
  ]);

  const linhas = csv.trim().split("\r\n");
  assert.deepEqual(linhas[0].split(","), COLUNAS_LOTE);
  assert.match(linhas[1], /prioridade_alta/);
  // A faixa nunca sai sozinha: confiança e versão da regra saem na mesma linha.
  assert.match(linhas[1], /alta/);
  assert.match(linhas[1], /score-2026-09-08-semente-1/);
  assert.match(linhas[1], new RegExp(RESSALVA_EXPORTACAO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(linhas[2].includes(RESSALVA_EXPORTACAO), false, "linha sem faixa não recebe ressalva");
});
