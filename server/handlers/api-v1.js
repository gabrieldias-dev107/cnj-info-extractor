// API interna versionada, para outros sistemas da BT Blue.
//
// O contrato é o caminho público `/api/v1/...`. A URL da Function agregadora
// (`/api/p1-query-handler?handler=...`) continua endereçável e NÃO é contrato:
// não a divulgue nem a use como endpoint.
//
// Autenticação: exclusivamente `Authorization: Bearer <token de serviço>`.
// Estas rotas ignoram o cookie de sessão e não chamam `origemPermitida` — um
// chamador servidor-a-servidor não manda `Origin` nem `sec-fetch-site`. Como não
// leem cookie, não há superfície de CSRF aqui. A entrada vem só do corpo; nada
// é lido da query, para que a agregadora não possa ser dirigida por parâmetro.
import { auditar, atorToken } from "../audit.js";
import { consultarDatajud } from "../datajud-client.js";
import { freshSnapshot, persistSnapshot, prefixoDoToken, serviceTokenByHash, touchServiceToken } from "../db.js";
import { normalizarNumero, validarNumeroParaConsulta } from "../cnj-validation.js";
import { consumirDatajud, consumirTokenServico } from "../rate-limit.js";
import { scoreDaConsulta } from "../p2-score.js";

const LIMITE_MOVIMENTOS = 20;

const STATUS_POR_CODIGO = {
  token_ausente: 401,
  token_invalido: 401,
  numero_invalido: 400,
  digito_verificador_invalido: 400,
  alias_invalido: 400,
  metodo_nao_permitido: 405,
  limite_excedido: 429,
  alias_inexistente: 502,
  cota_excedida: 502,
  tribunal_indisponivel: 502,
  timeout: 504,
  rede_indisponivel: 504,
  config_ausente: 500,
  api_indisponivel: 503,
  erro_interno: 500,
};

function erro(res, codigo, extra) {
  const status = STATUS_POR_CODIGO[codigo] || 500;
  if (extra && extra.retryAfter) res.setHeader("Retry-After", String(extra.retryAfter));
  return res.status(status).json({ error: codigo });
}

// `JSON.parse("null")` devolve null, e `null.numero` derruba o handler antes de
// qualquer resposta estruturada. Só objeto não nulo passa.
function corpo(req) {
  const bruto = typeof req.body === "string" ? tentarJson(req.body) : req.body;
  return bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {};
}

function tentarJson(texto) {
  try { return JSON.parse(texto); } catch { return null; }
}

function bearer(req) {
  const cabecalho = (req.headers && req.headers.authorization) || "";
  const encontrado = /^Bearer\s+(\S+)$/i.exec(String(Array.isArray(cabecalho) ? cabecalho[0] : cabecalho));
  return encontrado ? encontrado[1] : null;
}

function reqId(req) {
  const valor = req.headers && req.headers["x-vercel-id"];
  return typeof valor === "string" ? valor : null;
}

// Só os 4 últimos dígitos entram em qualquer registro — nem log nem trilha
// recebem o número inteiro.
function sufixo(digitos) {
  return digitos ? "…" + String(digitos).slice(-4) : null;
}

// Toda tentativa negada vira evento: trilha que só registra sucesso não serve
// para conformidade.
async function auditarNegativa(req, recurso, resultado, token) {
  const ator = token
    ? atorToken(token)
    : { actorType: "token", atorRotulo: "t_" + (prefixoDoToken(bearer(req)) || "desconhecido") };
  await auditar(Object.assign({}, ator, { acao: "api_v1", recurso, resultado, reqId: reqId(req) }));
}

// Devolve o token autenticado ou null — neste caso a resposta já foi enviada.
async function autenticar(req, res, recurso) {
  const apresentado = bearer(req);
  if (!apresentado) {
    await auditarNegativa(req, recurso, "negado_token_ausente", null);
    erro(res, "token_ausente");
    return null;
  }

  const token = await serviceTokenByHash(apresentado);
  // Revogado, vencido e inexistente respondem igual: distinguir os três diria a
  // quem tenta se o valor já existiu.
  if (!token) {
    await auditarNegativa(req, recurso, "negado_token_invalido", null);
    erro(res, "token_invalido");
    return null;
  }

  const cota = await consumirTokenServico(token.id, token.limiteDia);
  if (!cota.permitido) {
    await auditarNegativa(req, recurso, cota.indisponivel ? "negado_cota_indisponivel" : "negado_cota_excedida", token);
    erro(res, "limite_excedido", { retryAfter: cota.retryAfter });
    return null;
  }

  await touchServiceToken(token.id);
  return token;
}

function verificador(digitos) {
  const base = digitos.slice(0, 7) + digitos.slice(9, 20);
  return String(98n - (BigInt(base) * 100n) % 97n).padStart(2, "0");
}

function formatar(d) {
  return d.slice(0, 7) + "-" + d.slice(7, 9) + "." + d.slice(9, 13) + "." + d.slice(13, 14) + "." + d.slice(14, 16) + "." + d.slice(16, 20);
}

// `valido` é o dígito verificador, e nada mais. `validarNumeroParaConsulta`
// mistura duas coisas — dígito e existência de índice no DataJud — porque é o
// que a consulta precisa; para o decodificador isso faria um número
// perfeitamente válido de um segmento sem índice público sair como inválido,
// contradizendo `digitoVerificador === digitoEsperado` na mesma resposta.
function decodificacao(digitos) {
  const validacao = validarNumeroParaConsulta(digitos);
  const esperado = verificador(digitos);
  return {
    numero: digitos,
    formatado: formatar(digitos),
    valido: digitos.slice(7, 9) === esperado,
    sequencial: digitos.slice(0, 7),
    digitoVerificador: digitos.slice(7, 9),
    digitoEsperado: esperado,
    ano: digitos.slice(9, 13),
    segmento: digitos.slice(13, 14),
    tribunal: digitos.slice(14, 16),
    origem: digitos.slice(16, 20),
    alias: validacao.valido ? validacao.alias : null,
    // O alias é sempre derivado no servidor. Um segmento sem índice público no
    // DataJud não impede a decodificação, só a consulta online.
    consultaOnlineDisponivel: Boolean(validacao.valido),
  };
}

// Snapshot reduzido: o contrato da API interna é menor que o do proxy do
// navegador de propósito, para não prometer campo que o DataJud pode parar de
// mandar. `nivelSigilo` fica porque é o que permite ao integrador recusar o
// processo sigiloso.
function processoPublico(processo) {
  return {
    numeroProcesso: processo.numeroProcesso,
    classe: processo.classe || null,
    assuntos: Array.isArray(processo.assuntos) ? processo.assuntos : [],
    tribunal: processo.tribunal || null,
    grau: processo.grau || null,
    orgaoJulgador: processo.orgaoJulgador || null,
    dataAjuizamento: processo.dataAjuizamento || null,
    dataHoraUltimaAtualizacao: processo.dataHoraUltimaAtualizacao || null,
    nivelSigilo: processo.nivelSigilo,
    movimentos: (Array.isArray(processo.movimentos) ? processo.movimentos : []).slice(0, LIMITE_MOVIMENTOS),
  };
}

function preparar(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Authorization");
  return req.method === "POST";
}

export async function decodificar(req, res) {
  if (!preparar(req, res)) return erro(res, "metodo_nao_permitido");
  let token = null;
  let digitos = "";
  try {
    token = await autenticar(req, res, "decodificar");
    if (!token) return undefined;

    digitos = normalizarNumero(corpo(req).numero);
    if (digitos.length !== 20) {
      await auditar(Object.assign({}, atorToken(token), { acao: "api_v1", recurso: "decodificar", resultado: "negado_numero_invalido", reqId: reqId(req) }));
      return erro(res, "numero_invalido");
    }

    // Decodificação pura: não toca no DataJud e debita só a cota do token, já
    // consumida em `autenticar`.
    const resultado = decodificacao(digitos);
    await auditar(Object.assign({}, atorToken(token), {
      acao: "api_v1",
      recurso: "decodificar",
      resultado: resultado.valido ? "sucesso" : "sucesso_numero_invalido",
      reqId: reqId(req),
    }));
    return res.status(200).json(resultado);
  } catch (error) {
    return responderFalha(req, res, error, token, "decodificar", digitos);
  }
}

export async function processos(req, res) {
  if (!preparar(req, res)) return erro(res, "metodo_nao_permitido");
  let token = null;
  let digitos = "";
  try {
    token = await autenticar(req, res, "processos");
    if (!token) return undefined;

    digitos = normalizarNumero(corpo(req).numero);
    const validacao = validarNumeroParaConsulta(digitos);
    if (!validacao.valido) {
      await auditar(Object.assign({}, atorToken(token), { acao: "api_v1", recurso: "processos", resultado: "negado_" + validacao.erro, reqId: reqId(req) }));
      return erro(res, validacao.erro === "alias_desconhecido" ? "alias_invalido" : validacao.erro);
    }

    const emCache = await freshSnapshot(digitos);
    if (emCache) {
      await auditar(Object.assign({}, atorToken(token), {
        acao: "api_v1", recurso: "processos", resultado: "sucesso_cache", processId: emCache.processId, reqId: reqId(req),
      }));
      return res.status(200).json(resposta(emCache.dados, "servidor", emCache.estagio, emCache.score, emCache.processId));
    }

    // A chamada que alcança o DataJud também debita os contadores globais: a
    // cota do token limita o integrador, não protege o CNJ. `req` sintético
    // segue o precedente de api/batch-worker.js.
    //
    // `consumirDatajud` é fail-OPEN por desenho — tráfego manual com sessão não
    // pode parar porque o Redis caiu. Aqui isso não vale: deixar passar um
    // `indisponivel` daria ao integrador uma chamada ao DataJud fora de
    // qualquer contador, que é exatamente o que a cota por token existe para
    // impedir. A API interna trata indisponibilidade como recusa.
    const global = await consumirDatajud({ headers: { "x-forwarded-for": "api:" + token.id } });
    if (!global.permitido || global.indisponivel) {
      await auditar(Object.assign({}, atorToken(token), {
        acao: "api_v1", recurso: "processos",
        resultado: global.indisponivel ? "negado_cota_global_indisponivel" : "negado_cota_global",
        reqId: reqId(req),
      }));
      return erro(res, "limite_excedido", { retryAfter: global.retryAfter });
    }

    const dados = await consultarDatajud(digitos, validacao.alias);
    const salvo = await persistSnapshot({ numero: digitos, alias: validacao.alias, dados });
    await auditar(Object.assign({}, atorToken(token), {
      acao: "api_v1", recurso: "processos", resultado: "sucesso_datajud", processId: salvo.processId, reqId: reqId(req),
    }));
    return res.status(200).json(resposta(dados, null, salvo.estagio, salvo.score, salvo.processId));
  } catch (error) {
    return responderFalha(req, res, error, token, "processos", digitos);
  }
}

function resposta(dados, cache, estagio, score, processId) {
  const processos = Array.isArray(dados.processos) ? dados.processos : [];
  return {
    encontrado: Boolean(dados.encontrado),
    total: processos.length,
    cache,
    processId,
    processos: processos.map(processoPublico),
    estagio,
    // A faixa é indício, nunca decisão de crédito: `confianca`, `fatores`,
    // `aprovadaPorRisco` e `ressalva` viajam junto com ela em toda resposta.
    score: score || scoreDaConsulta(dados),
  };
}

// `digitos` chega já normalizado de quem chamou: reprocessar o corpo aqui
// significaria poder lançar de dentro do tratamento de erro.
async function responderFalha(req, res, error, token, recurso, digitos) {
  const codigo = String((error && (error.codigo || error.message)) || "erro_interno");
  const conhecido = Object.prototype.hasOwnProperty.call(STATUS_POR_CODIGO, codigo);
  const final = conhecido ? codigo : (codigo === "banco_indisponivel" ? "api_indisponivel" : "erro_interno");
  console.error(JSON.stringify({
    evento: "api_v1_falhou",
    recurso,
    erro: final,
    numero: sufixo(digitos),
    reqId: reqId(req),
  }));
  if (token) {
    await auditar(Object.assign({}, atorToken(token), { acao: "api_v1", recurso, resultado: "falha_" + final, reqId: reqId(req) }));
  }
  return erro(res, final);
}
