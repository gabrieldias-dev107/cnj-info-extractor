// Score de elegibilidade para antecipação — módulo puro, sem I/O.
//
// PESOS SEMENTE, PENDENTES DE APROVAÇÃO DA ÁREA DE RISCO. Nada aqui foi
// validado contra carteira real. A versão abaixo existe justamente para que uma
// faixa gravada hoje continue rastreável quando a curadoria mudar os pesos.
//
// A faixa é INDÍCIO derivado da base pública do DataJud, nunca decisão de
// crédito e nunca certidão. Por isso toda saída carrega `confianca`, `fatores`,
// `aprovadaPorRisco: false`, `fonte` e `ressalva` — e a interface, o CSV, o
// XLSX e a API v1 mostram os cinco junto da faixa.
import { estagioAprovado } from "./tpu-catalog.js";
import { classificarEstagio } from "./p0-core.js";
import { normalizarNumero } from "./cnj-validation.js";

export const VERSAO_REGRAS_SCORE = "score-2026-09-08-semente-1";

export const FONTE_SCORE = "indicio_publico_datajud";

const RESSALVA_BASE =
  "Indício derivado da base pública do DataJud, com pesos semente pendentes de " +
  "aprovação da área de risco. Não é decisão de crédito nem certidão.";

const RESSALVA_SEM_ESTAGIO =
  "Estágio processual desconhecido: nenhum movimento com código TPU curado foi " +
  "encontrado, então a faixa saiu apenas dos sinais secundários. " + RESSALVA_BASE;

// Versão curta da ressalva, para caber numa célula de planilha. Vai em toda
// linha que tem faixa: um arquivo exportado circula sem o contexto da tela, e a
// faixa sozinha é exatamente o que não pode viajar.
export const RESSALVA_EXPORTACAO =
  "indício DataJud; pesos semente não aprovados pela área de risco; não é decisão de crédito";

const CORTE_ALTA = 60;
const CORTE_MEDIA = 30;

const DIA_MS = 86400000;

// Rótulos neutros de propósito: a faixa ordena a fila de análise, não classifica
// o processo como bom ou ruim.
export const FAIXAS = ["prioridade_alta", "prioridade_media", "prioridade_baixa"];

// O DataJud manda data em dois formatos: ISO 8601 (movimentos,
// dataHoraUltimaAtualizacao) e numérico AAAAMMDD[HHMMSS] (dataAjuizamento).
// Devolve milissegundos ou null; nunca lança.
export function parseDataProcesso(valor) {
  const texto = String(valor == null ? "" : valor).trim();
  if (!texto) return null;
  if (/^\d{8,14}$/.test(texto)) {
    const iso = texto.slice(0, 4) + "-" + texto.slice(4, 6) + "-" + texto.slice(6, 8) +
      (texto.length >= 12 ? "T" + texto.slice(8, 10) + ":" + texto.slice(10, 12) + ":00Z" : "T00:00:00Z");
    const numerico = Date.parse(iso);
    return Number.isFinite(numerico) ? numerico : null;
  }
  const parsed = Date.parse(texto);
  return Number.isFinite(parsed) ? parsed : null;
}

function fator(nome, pontos, motivo) {
  return { fator: nome, pontos, motivo };
}

// Único sinal jurídico curado. Sem código TPU aprovado não há estágio, e o
// rótulo nunca aparece sem o movimento e a data que o originaram.
function fatorEstagio(estagio) {
  if (!estagio || !estagioAprovado(estagio.estagio)) {
    return fator("estagio_tpu", 0, "Nenhum movimento com código TPU curado foi encontrado.");
  }
  const data = estagio.data ? String(estagio.data).slice(0, 10) : "data não informada";
  return fator("estagio_tpu", 40, "Estágio " + estagio.estagio + " pelo movimento TPU " + estagio.codigo + " em " + data + ".");
}

// Idade do PROCESSO, medida pelo ajuizamento. Não confundir com `idadeEmDias`
// de server/p0-core.js, que mede a idade do movimento.
function fatorIdadeProcesso(dataAjuizamento, agoraMs) {
  const ajuizamento = parseDataProcesso(dataAjuizamento);
  if (ajuizamento === null) return fator("idade_processo", 0, "Data de ajuizamento ausente no retorno do DataJud.");

  const anos = (agoraMs - ajuizamento) / (365 * DIA_MS);
  const desde = "ajuizado em " + new Date(ajuizamento).toISOString().slice(0, 10);
  if (anos < 0) return fator("idade_processo", 0, "Data de ajuizamento no futuro (" + desde + "); sinal descartado.");
  if (anos >= 5) return fator("idade_processo", 20, "Processo com 5 anos ou mais (" + desde + ").");
  if (anos >= 2) return fator("idade_processo", 12, "Processo entre 2 e 5 anos (" + desde + ").");
  if (anos >= 1) return fator("idade_processo", 6, "Processo entre 1 e 2 anos (" + desde + ").");
  return fator("idade_processo", 2, "Processo com menos de 1 ano (" + desde + ").");
}

const PONTOS_POR_GRAU = { G1: 15, JE: 12, G2: 6, TR: 2, SUP: 2 };

function fatorGrau(grau) {
  const chave = String(grau || "").toUpperCase();
  if (!chave) return fator("grau", 0, "Grau não informado pelo tribunal.");
  const pontos = PONTOS_POR_GRAU[chave];
  if (pontos === undefined) return fator("grau", 0, "Grau " + chave + " fora da tabela de pesos.");
  return fator("grau", pontos, "Grau " + chave + ".");
}

// Cobertura e ritmo de publicação variam muito por segmento. Os pesos abaixo
// refletem a experiência da operação, não uma medição — são semente.
const PONTOS_POR_SEGMENTO = { "8": 10, "4": 8, "5": 8, "6": 3, "9": 3, "1": 2, "3": 2, "7": 2 };

function fatorSegmento(numeroProcesso, tribunal) {
  const digitos = normalizarNumero(numeroProcesso);
  if (digitos.length !== 20) return fator("segmento", 0, "Número do processo indisponível para derivar o segmento.");
  const segmento = digitos.slice(13, 14);
  const pontos = PONTOS_POR_SEGMENTO[segmento];
  const rotulo = "segmento " + segmento + (tribunal ? " (" + tribunal + ")" : "");
  if (pontos === undefined) return fator("segmento", 0, "Segmento " + segmento + " fora da tabela de pesos.");
  return fator("segmento", pontos, "Cobertura esperada para o " + rotulo + ".");
}

// Processo parado é risco de prazo; processo com movimento recente costuma ter
// dado confiável no índice. A data usada é a do movimento mais recente.
function fatorCadencia(movimentos, agoraMs) {
  const datas = (Array.isArray(movimentos) ? movimentos : [])
    .map((movimento) => parseDataProcesso(movimento && movimento.dataHora))
    .filter((valor) => valor !== null);
  if (!datas.length) return fator("cadencia_movimentos", 0, "Sem movimentos datados no retorno do DataJud.");

  const maisRecente = Math.max(...datas);
  const dias = Math.max(0, Math.floor((agoraMs - maisRecente) / DIA_MS));
  const desde = "último movimento em " + new Date(maisRecente).toISOString().slice(0, 10) + ", há " + dias + (dias === 1 ? " dia" : " dias");
  if (dias <= 30) return fator("cadencia_movimentos", 15, "Movimentação nos últimos 30 dias (" + desde + ").");
  if (dias <= 90) return fator("cadencia_movimentos", 8, "Movimentação nos últimos 90 dias (" + desde + ").");
  if (dias <= 365) return fator("cadencia_movimentos", 3, "Movimentação no último ano (" + desde + ").");
  return fator("cadencia_movimentos", 0, "Sem movimentação há mais de um ano (" + desde + ").");
}

function faixaPorPontos(pontos) {
  if (pontos >= CORTE_ALTA) return "prioridade_alta";
  if (pontos >= CORTE_MEDIA) return "prioridade_media";
  return "prioridade_baixa";
}

// `confianca` é o antídoto contra ler a faixa como certeza. Sem estágio TPU
// curado ela é sempre "baixa" — hoje o caso comum, porque server/tpu-catalog.js
// mapeia um único código.
function confiancaPorSinais(temEstagio, fatores) {
  if (!temEstagio) return "baixa";
  const secundariosVazios = fatores.filter((item) => item.fator !== "estagio_tpu" && item.pontos === 0).length;
  return secundariosVazios ? "media" : "alta";
}

export function calcularScore(processo, agora = new Date().toISOString()) {
  const dados = processo || {};
  const agoraMs = parseDataProcesso(agora) ?? Date.now();
  const movimentos = Array.isArray(dados.movimentos) ? dados.movimentos : [];
  const estagio = classificarEstagio(movimentos, new Date(agoraMs).toISOString());
  const temEstagio = estagioAprovado(estagio.estagio);

  const fatores = [
    fatorEstagio(estagio),
    fatorIdadeProcesso(dados.dataAjuizamento, agoraMs),
    fatorGrau(dados.grau),
    fatorSegmento(dados.numeroProcesso, dados.tribunal),
    fatorCadencia(movimentos, agoraMs),
  ];

  const pontos = fatores.reduce((total, item) => total + item.pontos, 0);

  return {
    faixa: faixaPorPontos(pontos),
    pontos,
    confianca: confiancaPorSinais(temEstagio, fatores),
    fatores,
    versao: VERSAO_REGRAS_SCORE,
    aprovadaPorRisco: false,
    fonte: FONTE_SCORE,
    ressalva: temEstagio ? RESSALVA_BASE : RESSALVA_SEM_ESTAGIO,
  };
}

// A consulta devolve uma lista de instâncias ordenada por grau. Grau, segmento e
// ajuizamento vêm da instância mais relevante — a primeira dessa ordenação —,
// mas os movimentos são os de TODAS as instâncias, exatamente como
// `classificarEstagio` faz em `persistSnapshot`. Sem isso o fator `estagio_tpu`
// poderia dizer "nenhum movimento curado" ao lado de uma coluna `estagio`
// classificada por um movimento da segunda instância.
export function scoreDaConsulta(resposta, agora = new Date().toISOString()) {
  const processos = resposta && Array.isArray(resposta.processos) ? resposta.processos : [];
  if (!processos.length) return calcularScore(null, agora);
  const movimentos = processos.flatMap((processo) => (Array.isArray(processo.movimentos) ? processo.movimentos : []));
  return calcularScore(Object.assign({}, processos[0], { movimentos }), agora);
}

export const RESSALVA_VERSAO_ANTIGA =
  "Faixa gravada por uma versão anterior das regras de score; os fatores que a " +
  "originaram não são reconstituíveis. Reconsulte o processo para recalcular. " + RESSALVA_BASE;

// A faixa gravada em `snapshots` é a autoridade — é ela que a tabela do lote e
// as exportações leem. Aqui a explicação é reconstruída ancorada em
// `consultadoEm`, o instante da gravação: mesma regra + mesmos dados + mesmo
// instante reproduzem exatamente `faixa` e `pontos` persistidos. Quando a versão
// da regra mudou, a faixa persistida prevalece e a explicação dá lugar à
// ressalva — inventar fatores novos para uma faixa velha seria mentir.
export function scoreDoSnapshot(persistido, dados, consultadoEm) {
  const versao = persistido && persistido.versao;
  if (!versao || versao === VERSAO_REGRAS_SCORE) {
    return scoreDaConsulta(dados, consultadoEm || new Date().toISOString());
  }
  return {
    faixa: persistido.faixa,
    pontos: persistido.pontos,
    confianca: "baixa",
    fatores: [],
    versao,
    aprovadaPorRisco: false,
    fonte: FONTE_SCORE,
    ressalva: RESSALVA_VERSAO_ANTIGA,
  };
}
