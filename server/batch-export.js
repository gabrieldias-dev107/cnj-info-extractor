import { RESSALVA_EXPORTACAO } from "./p2-score.js";

// Colunas do arquivo exportado. A faixa nunca sai sozinha: `score_confianca`
// distingue a faixa apoiada em movimento TPU curado daquela tirada só de sinais
// secundários, `score_versao` diz por qual regra ela foi calculada, e
// `score_ressalva` repete o aviso em toda linha que tem faixa — a planilha
// circula fora da ferramenta, sem o contexto que a tela dá.
//
// Os `fatores` ficam de fora: são uma lista por linha, não cabem em célula. Quem
// precisa deles usa a consulta unitária ou POST /api/v1/processos.
export const COLUNAS_LOTE = ["linha", "numero", "status", "erro", "estagio", "score_faixa", "score_confianca", "score_versao", "score_ressalva"];

export function linhasDoLote(itens) {
  return (Array.isArray(itens) ? itens : []).map((item) => COLUNAS_LOTE.map((coluna) => (
    coluna === "score_ressalva" ? (item.score_faixa ? RESSALVA_EXPORTACAO : "") : item[coluna]
  )));
}

function campo(valor) {
  let texto = String(valor == null ? "" : valor);
  if (/^[=+\-@]/.test(texto)) texto = "'" + texto;
  return /[",\r\n]/.test(texto) ? "\"" + texto.replace(/\"/g, "\"\"") + "\"" : texto;
}

export function csvDeLote(itens) {
  const linhas = linhasDoLote(itens).map((valores) => valores.map(campo).join(","));
  return COLUNAS_LOTE.join(",") + "\r\n" + linhas.join("\r\n") + (linhas.length ? "\r\n" : "");
}
