import { consultarDatajud } from "./datajud-client.js";
import { executarPipeline } from "./rate-limit.js";

// Três tentativas no total (a chamada e duas retentativas): o mesmo número que
// abre o circuito, para que um item que esgota as tentativas deixe o alias
// fechado em vez de continuar martelando um tribunal fora do ar.
export const TENTATIVAS_MAXIMAS = 3;
export const ATRASOS_RETENTATIVA_MS = [1000, 2000];
export const LIMITE_FALHAS_CIRCUITO = 3;
export const JANELA_CIRCUITO_S = 30 * 60;

// Só 429 e 5xx são transitórios o bastante para valer nova tentativa; alias
// inexistente e configuração ausente não melhoram com repetição.
const CODIGOS_RETENTAVEIS = new Set(["cota_excedida", "tribunal_indisponivel"]);
const CODIGOS_FALHA_TRIBUNAL = new Set(["cota_excedida", "tribunal_indisponivel", "timeout", "rede_indisponivel"]);

const STATUS_POR_CODIGO = {
  cota_excedida: { status: "degradado", statusCode: 429 },
  timeout: { status: "degradado", statusCode: null },
  tribunal_indisponivel: { status: "indisponivel", statusCode: 503 },
  alias_inexistente: { status: "indisponivel", statusCode: 404 },
  rede_indisponivel: { status: "indisponivel", statusCode: null },
};

function falha(codigo) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  return erro;
}

export function codigoDoErro(erro) {
  return String((erro && (erro.codigo || erro.message)) || "erro_interno");
}

function chaveCircuito(alias) {
  return "cb:datajud:" + String(alias);
}

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Circuito e orçamento moram no mesmo Upstash do rate limit; não há tabela de
// estado no Postgres para nenhum dos dois.
export async function circuitoAberto(alias) {
  const pipeline = await executarPipeline([["GET", chaveCircuito(alias)]]);
  // Redis indisponível não abre o circuito por conta própria: o orçamento
  // diário já falha fechado e barra qualquer chamada nessa situação.
  if (!pipeline.ok) return false;
  const contagem = Number(pipeline.resultados[0].result);
  return Number.isFinite(contagem) && contagem >= LIMITE_FALHAS_CIRCUITO;
}

export async function registrarFalhaCircuito(alias) {
  const chave = chaveCircuito(alias);
  const pipeline = await executarPipeline([["INCR", chave], ["EXPIRE", chave, String(JANELA_CIRCUITO_S)]]);
  return pipeline.ok ? Number(pipeline.resultados[0].result) : null;
}

export async function limparCircuito(alias) {
  await executarPipeline([["DEL", chaveCircuito(alias)]]);
}

export function classificarFalhaTribunal(codigo) {
  return STATUS_POR_CODIGO[String(codigo)] || { status: "indisponivel", statusCode: null };
}

// Orquestra circuito, orçamento e retentativa em volta do cliente DataJud já
// existente. `consultar` e `esperar` são injetáveis só para teste.
export async function consultarComResiliencia(numero, alias, { consumirOrcamento, consultar = consultarDatajud, esperar = dormir } = {}) {
  if (await circuitoAberto(alias)) throw falha("circuito_aberto");

  let ultimoErro = falha("erro_interno");
  for (let tentativa = 0; tentativa < TENTATIVAS_MAXIMAS; tentativa += 1) {
    const orcamento = await consumirOrcamento();
    if (!orcamento || !orcamento.permitido) throw falha("orcamento_excedido");

    try {
      const resposta = await consultar(numero, alias);
      await limparCircuito(alias);
      return resposta;
    } catch (erro) {
      const codigo = codigoDoErro(erro);
      if (CODIGOS_FALHA_TRIBUNAL.has(codigo)) await registrarFalhaCircuito(alias);
      if (!CODIGOS_RETENTAVEIS.has(codigo)) throw erro;
      ultimoErro = erro;
      if (tentativa < TENTATIVAS_MAXIMAS - 1) await esperar(ATRASOS_RETENTATIVA_MS[tentativa]);
    }
  }
  throw ultimoErro;
}

function escaparHtml(valor) {
  return String(valor === null || valor === undefined ? "" : valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function transicao(alerta) {
  return String(alerta.estagio_anterior || "sem classificação") + " → " + String(alerta.estagio_atual || "");
}

// O corpo do digest é montado aqui, e não no worker, para ficar testável e
// para garantir escape de tudo que vem do banco.
export function montarEmailDigest(alertas) {
  const linhas = Array.isArray(alertas) ? alertas : [];
  const assunto = "Resumo diário de monitoramento — " + linhas.length + " movimentação(ões)";
  const itensHtml = linhas
    .map((alerta) => "<li><strong>" + escaparHtml(alerta.numero) + "</strong>: " + escaparHtml(transicao(alerta)) + "</li>")
    .join("");
  const html = "<h1>" + escaparHtml(assunto) + "</h1><ul>" + itensHtml + "</ul>";
  const texto = [assunto, ""].concat(linhas.map((alerta) => "- " + alerta.numero + ": " + transicao(alerta))).join("\n");
  return { assunto, html, texto };
}
