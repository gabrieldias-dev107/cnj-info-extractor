import { descricaoMovimento as obterDescricaoMovimento, estagioAprovado } from "./tpu-catalog.js";

export function descricaoMovimento(codigo) {
  return obterDescricaoMovimento(codigo);
}

export function mudancaRelevante(anterior, atual) {
  const estagioAnterior = anterior && anterior.estagio;
  const estagioAtual = atual && atual.estagio;
  if (estagioAnterior === estagioAtual) return false;
  return estagioAprovado(estagioAnterior) || estagioAprovado(estagioAtual);
}
