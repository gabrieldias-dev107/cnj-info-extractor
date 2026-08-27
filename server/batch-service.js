import { validarNumeroParaConsulta } from "./cnj-validation.js";
import { validarLote } from "./p0-core.js";

export function prepararLote(numeros) {
  if (!Array.isArray(numeros)) throw new Error("lote_invalido");
  if (!numeros.length) throw new Error("lote_vazio");
  if (numeros.length > 500) throw new Error("lote_maior_que_500");
  return validarLote(numeros, validarNumeroParaConsulta);
}

export function numerosDaPlanilha(linhas) {
  if (!Array.isArray(linhas) || !linhas.length) return [];
  const cabecalho = Array.isArray(linhas[0]) ? linhas[0].map((valor) => String(valor).trim().toLowerCase()) : [];
  const coluna = cabecalho.indexOf("numero");
  const inicio = coluna >= 0 ? 1 : 0;
  return linhas.slice(inicio).map((linha) => Array.isArray(linha) ? linha[coluna >= 0 ? coluna : 0] : "").filter((valor) => String(valor || "").trim());
}
