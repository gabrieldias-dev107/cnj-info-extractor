const BASE = "https://api-publica.datajud.cnj.jus.br";
const TIMEOUT_MS = 12000;
const MAX_HITS = 20;
const RANK_GRAU = { G1: 1, JE: 2, G2: 3, TR: 4, SUP: 5 };

function falha(codigo) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  return erro;
}

function chave() {
  const valor = String(process.env.DATAJUD_API_KEY || "").trim();
  if (!valor) throw falha("config_ausente");
  return valor;
}

function normalizar(processo) {
  return {
    numeroProcesso: processo.numeroProcesso,
    classe: processo.classe || null,
    assuntos: Array.isArray(processo.assuntos) ? processo.assuntos : [],
    tribunal: processo.tribunal || null,
    grau: processo.grau || null,
    sistema: processo.sistema || null,
    formato: processo.formato || null,
    orgaoJulgador: processo.orgaoJulgador || null,
    dataAjuizamento: processo.dataAjuizamento || null,
    dataHoraUltimaAtualizacao: processo.dataHoraUltimaAtualizacao || null,
    nivelSigilo: processo.nivelSigilo,
    movimentos: (Array.isArray(processo.movimentos) ? processo.movimentos : [])
      .map((movimento) => ({ codigo: movimento.codigo, nome: movimento.nome, dataHora: movimento.dataHora }))
      .sort((a, b) => String(b.dataHora).localeCompare(String(a.dataHora))),
  };
}

function ordenar(processos) {
  return processos.slice().sort((a, b) => {
    const rankA = RANK_GRAU[String(a.grau || "").toUpperCase()] || 99;
    const rankB = RANK_GRAU[String(b.grau || "").toUpperCase()] || 99;
    if (rankA !== rankB) return rankA - rankB;
    return String(b.dataHoraUltimaAtualizacao || "").localeCompare(String(a.dataHoraUltimaAtualizacao || ""));
  });
}

export async function consultarDatajud(numero, alias, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resposta;
  try {
    resposta = await fetchImpl(BASE + "/" + alias + "/_search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "APIKey " + chave() },
      body: JSON.stringify({ size: MAX_HITS, query: { match: { numeroProcesso: numero } } }),
      signal: controller.signal,
    });
  } catch (error) {
    throw falha(error && error.name === "AbortError" ? "timeout" : "rede_indisponivel");
  } finally {
    clearTimeout(timer);
  }
  if (!resposta.ok) {
    if (resposta.status === 404) throw falha("alias_inexistente");
    if (resposta.status === 429) throw falha("cota_excedida");
    if (resposta.status >= 500) throw falha("tribunal_indisponivel");
    throw falha("erro_interno");
  }
  const dados = await resposta.json();
  const processos = ordenar(((dados && dados.hits && dados.hits.hits) || [])
    .map((hit) => hit && hit._source).filter(Boolean).map(normalizar));
  return { encontrado: processos.length > 0, total: processos.length, processos };
}
