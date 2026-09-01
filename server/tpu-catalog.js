export const VERSAO_TPU = "tpu-2026-04-09-semente-1";

// Esta é a única fonte de estágios juridicamente aprovados. Não use nomes
// recebidos do DataJud para classificar ou alertar.
const MOVIMENTOS_APROVADOS = new Map([
  [12548, Object.freeze({ codigo: 12548, descricao: "Expedição de alvará", estagio: "expedicao_alvara", versao: VERSAO_TPU })],
]);

export function descricaoMovimento(codigo) {
  const movimento = MOVIMENTOS_APROVADOS.get(Number(codigo));
  return movimento ? { ...movimento } : null;
}

export function estagioAprovado(estagio) {
  return Array.from(MOVIMENTOS_APROVADOS.values()).some((movimento) => movimento.estagio === estagio);
}
