// Proxy serverless (Vercel) para a API Pública do DataJud (CNJ).
// Existe para resolver CORS (a API exige header Authorization, que o browser
// não consegue enviar cross-origin) e para centralizar a chave pública.
// Rota automática: /api/datajud. Runtime Node (fetch global no Node 18+).
//
// A consulta online exige sessão; o decodificador estático permanece público.

import { sessaoValida } from "../server/auth.js";
import { origemPermitida } from "../server/origin.js";
import { consumirDatajud } from "../server/rate-limit.js";
import { currentUser } from "../server/sso.js";
import { freshSnapshot, persistSnapshot, recordConsultation } from "../server/db.js";
import { ssoConfigurado } from "../server/sso-config.js";

var BASE = "https://api-publica.datajud.cnj.jus.br";
var ALIAS_RE = /^api_publica_[a-z0-9-]{1,52}$/;
var TIMEOUT_MS = 12000;
var MAX_HITS = 20;

// --- observabilidade ---------------------------------------------------------

// Uma linha JSON por evento, para que a busca no log da Vercel seja por campo
// e não por substring. O número do processo NÃO é logado inteiro: dado
// processual vincula-se a pessoa identificável e não há ainda política de
// retenção definida. Os 4 últimos dígitos bastam para correlacionar.
function log(nivel, evento, campos) {
  var linha = Object.assign({ ts: new Date().toISOString(), nivel: nivel, evento: evento }, campos || {});
  var texto = JSON.stringify(linha);
  if (nivel === "error") console.error(texto);
  else console.log(texto);
}

function sufixo(digitos) {
  return digitos ? "…" + String(digitos).slice(-4) : null;
}

// Erro com código da taxonomia; o handler traduz código -> status HTTP.
function falha(codigo, extra) {
  var e = new Error(codigo);
  e.codigo = codigo;
  e.extra = extra || {};
  return e;
}

var STATUS_POR_CODIGO = {
  config_ausente: 500,
  autenticacao_necessaria: 401,
  origem_nao_permitida: 403,
  limite_excedido: 429,
  metodo_nao_permitido: 405,
  numero_invalido: 400,
  alias_invalido: 400,
  alias_inexistente: 502,
  cota_excedida: 502,
  tribunal_indisponivel: 502,
  timeout: 504,
  rede_indisponivel: 504,
  erro_interno: 500,
};

// --- configuração ------------------------------------------------------------

// Sem fallback embutido: a chave é rotacionada pelo CNJ e uma cópia versionada
// no repositório sempre acaba desatualizada e exposta. Ausência é erro de
// configuração explícito, não silenciosamente um 504 que parece falha do CNJ.
function authHeader() {
  var k = process.env.DATAJUD_API_KEY;
  if (!k || !k.trim()) throw falha("config_ausente", { variavel: "DATAJUD_API_KEY" });
  return "APIKey " + k.trim();
}

// --- normalização do retorno -------------------------------------------------

// Reduz o _source do DataJud ao essencial para o front e ordena os movimentos
// do mais recente para o mais antigo (dataHora é ISO 8601, ordena como string).
function normalizar(s) {
  var movs = Array.isArray(s.movimentos) ? s.movimentos : [];
  return {
    numeroProcesso: s.numeroProcesso,
    classe: s.classe || null,
    assuntos: Array.isArray(s.assuntos) ? s.assuntos : [],
    tribunal: s.tribunal || null,
    grau: s.grau || null,
    sistema: s.sistema || null,
    formato: s.formato || null,
    orgaoJulgador: s.orgaoJulgador || null,
    dataAjuizamento: s.dataAjuizamento || null,
    dataHoraUltimaAtualizacao: s.dataHoraUltimaAtualizacao || null,
    nivelSigilo: s.nivelSigilo,
    movimentos: movs
      .map(function (m) { return { codigo: m.codigo, nome: m.nome, dataHora: m.dataHora }; })
      .sort(function (a, b) { return String(b.dataHora).localeCompare(String(a.dataHora)); }),
  };
}

// O mesmo número existe em mais de um grau (originário e recurso) e em índices
// distintos. Devolver só o primeiro hit omitia justamente a instância mais
// recente, que é o que a triagem precisa saber.
var RANK_GRAU = { G1: 1, JE: 2, G2: 3, TR: 4, SUP: 5 };

export function ordenarInstancias(lista) {
  return lista.slice().sort(function (a, b) {
    var ra = RANK_GRAU[String(a.grau || "").toUpperCase()] || 99;
    var rb = RANK_GRAU[String(b.grau || "").toUpperCase()] || 99;
    if (ra !== rb) return ra - rb;
    // Mesmo grau: mais recentemente atualizado primeiro.
    return String(b.dataHoraUltimaAtualizacao || "")
      .localeCompare(String(a.dataHoraUltimaAtualizacao || ""));
  });
}

// --- handler -----------------------------------------------------------------

export default async function handler(req, res) {
  var inicio = Date.now();
  var reqId = req.headers["x-vercel-id"] || null;
  var alias = "";
  var digitos = "";

  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "private, no-store");

  function responderErro(codigo, extra) {
    var status = STATUS_POR_CODIGO[codigo] || 500;
    log(status >= 500 ? "error" : "warn", codigo, Object.assign({
      reqId: reqId,
      alias: alias || null,
      numero: sufixo(digitos),
      status: status,
      duracaoMs: Date.now() - inicio,
    }, extra || {}));
    if (extra && extra.retryAfter) res.setHeader("Retry-After", String(extra.retryAfter));
    res.status(status).json({ error: codigo });
  }

  try {
    if (req.method !== "POST") return responderErro("metodo_nao_permitido", { metodo: req.method });

    if (!origemPermitida(req)) {
      return responderErro("origem_nao_permitida", { origin: req.headers.origin || null });
    }

    if (ssoConfigurado()) {
      var usuario = await currentUser(req);
      if (!usuario) return responderErro("autenticacao_necessaria");
    } else if (!sessaoValida(req)) return responderErro("autenticacao_necessaria");

    var body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    digitos = String(body.numero || "").replace(/\D/g, "");
    alias = String(body.alias || "");

    if (digitos.length !== 20) return responderErro("numero_invalido");
    if (!ALIAS_RE.test(alias)) return responderErro("alias_invalido");

    if (ssoConfigurado()) {
      var emCache = await freshSnapshot(digitos);
      if (emCache) {
        log("info", "consulta_cache", { reqId: reqId, alias: alias, numero: sufixo(digitos) });
        return res.status(200).json(Object.assign({}, emCache, { cache: "servidor" }));
      }
    }

    var auth = authHeader(); // lança config_ausente antes de qualquer rede

    var limite = await consumirDatajud(req, Date.now());
    if (!limite.permitido) {
      return responderErro("limite_excedido", {
        escopo: limite.escopo, limite: limite.limite, retryAfter: limite.retryAfter,
      });
    }
    if (limite.indisponivel) {
      // Fail-open: registrado para que a lacuna de proteção fique visível no log.
      log("warn", "rate_limit_indisponivel", { reqId: reqId, motivo: limite.motivo });
    }

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    var r;
    try {
      r = await fetch(BASE + "/" + alias + "/_search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ size: MAX_HITS, query: { match: { numeroProcesso: digitos } } }),
        signal: controller.signal,
      });
    } catch (e) {
      // Distinguir aborto de falha de rede; nenhum dos dois é bug nosso.
      if (e && e.name === "AbortError") throw falha("timeout", { timeoutMs: TIMEOUT_MS });
      throw falha("rede_indisponivel", { causa: (e && e.message) || String(e) });
    } finally {
      clearTimeout(timer);
    }

    if (!r.ok) {
      // Taxonomia por status: alias inexistente, cota do CNJ e indisponibilidade
      // do tribunal exigem mensagens diferentes na interface.
      if (r.status === 404) throw falha("alias_inexistente", { statusDatajud: 404 });
      if (r.status === 429) throw falha("cota_excedida", { statusDatajud: 429 });
      if (r.status >= 500) throw falha("tribunal_indisponivel", { statusDatajud: r.status });
      throw falha("erro_interno", { statusDatajud: r.status });
    }

    var data = await r.json();
    var hits = (data && data.hits && data.hits.hits) || [];
    var processos = ordenarInstancias(
      hits.map(function (h) { return h && h._source; }).filter(Boolean).map(normalizar)
    );

    if (!processos.length) {
      // Índice vazio não é erro, mas precisa ser mensurável: é o insumo do
      // futuro painel de cobertura por tribunal.
      log("info", "indice_vazio", {
        reqId: reqId, alias: alias, numero: sufixo(digitos), duracaoMs: Date.now() - inicio,
      });
      var vazio = { encontrado: false, total: 0, processos: [] };
      if (ssoConfigurado()) {
        var salvoVazio = await persistSnapshot({ numero: digitos, alias: alias, dados: vazio });
        await recordConsultation(usuario.id, salvoVazio.processId, "unitaria");
        vazio.estagio = salvoVazio.estagio;
      }
      res.status(200).json(vazio);
      return;
    }

    log("info", "consulta_ok", {
      reqId: reqId,
      alias: alias,
      numero: sufixo(digitos),
      total: processos.length,
      truncado: hits.length >= MAX_HITS,
      duracaoMs: Date.now() - inicio,
    });

    var resposta = { encontrado: true, total: processos.length, processos: processos };
    if (ssoConfigurado()) {
      var salvo = await persistSnapshot({ numero: digitos, alias: alias, dados: resposta });
      await recordConsultation(usuario.id, salvo.processId, "unitaria");
      resposta.estagio = salvo.estagio;
    }
    res.status(200).json(resposta);
  } catch (e) {
    if (e && e.codigo) return responderErro(e.codigo, e.extra);
    // Sem código na taxonomia = bug nosso. Antes isto virava 504 e ficava
    // indistinguível de falha do DataJud.
    return responderErro("erro_interno", { causa: (e && e.message) || String(e) });
  }
}
