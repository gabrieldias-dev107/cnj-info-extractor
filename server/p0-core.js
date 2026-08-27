export const VERSAO_TPU = "tpu-2026-04-09-semente-1";

// Códigos são deliberadamente a única fonte de classificação. O mapa cresce
// somente por revisão jurídica da TPU; nomes vindos do DataJud nunca decidem.
const ESTAGIO_POR_CODIGO = new Map([
  [12548, "expedicao_alvara"],
]);

// `penhora` e `execucao` ainda não são alcançáveis: nenhum código da TPU está
// mapeado para eles. Os TTLs ficam pré-provisionados para que a curadoria
// jurídica precise mexer só em ESTAGIO_POR_CODIGO.
const TTL_POR_ESTAGIO = {
  expedicao_alvara: 24 * 60 * 60 * 1000,
  penhora: 24 * 60 * 60 * 1000,
  execucao: 3 * 24 * 60 * 60 * 1000,
};

export function ttlPorEstagio(estagio) {
  return TTL_POR_ESTAGIO[estagio] || 7 * 24 * 60 * 60 * 1000;
}

export function classificarEstagio(movimentos, agora = new Date().toISOString()) {
  const relevantes = (Array.isArray(movimentos) ? movimentos : [])
    .filter((movimento) => ESTAGIO_POR_CODIGO.has(Number(movimento && movimento.codigo)))
    .sort((a, b) => String(b.dataHora || "").localeCompare(String(a.dataHora || "")));
  const movimento = relevantes[0];
  if (!movimento) return { estagio: "nao_classificado", codigo: null, data: null, idadeDias: null, versao: VERSAO_TPU };

  const data = String(movimento.dataHora || "");
  const diferenca = Date.parse(agora) - Date.parse(data);
  return {
    estagio: ESTAGIO_POR_CODIGO.get(Number(movimento.codigo)),
    codigo: Number(movimento.codigo),
    data,
    idadeDias: Number.isFinite(diferenca) ? Math.max(0, Math.floor(diferenca / 86400000)) : null,
    versao: VERSAO_TPU,
  };
}

export function validarLote(linhas, validarNumero) {
  const vistos = new Set();
  return (Array.isArray(linhas) ? linhas : []).map((valor, indice) => {
    const numero = String(valor || "").replace(/\D/g, "");
    const linha = indice + 1;
    const resultado = validarNumero(numero);
    if (!resultado || !resultado.valido) return { linha, numero, alias: null, status: "invalido", erro: (resultado && resultado.erro) || "numero_invalido" };
    if (vistos.has(numero)) return { linha, numero, alias: resultado.alias, status: "duplicado", erro: "duplicado" };
    vistos.add(numero);
    return { linha, numero, alias: resultado.alias, status: "pendente", erro: null };
  });
}
