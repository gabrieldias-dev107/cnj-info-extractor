// Proxy serverless (Vercel) para a API Pública do DataJud (CNJ).
// Existe para resolver CORS (a API exige header Authorization, que o browser
// não consegue enviar cross-origin) e para centralizar a chave pública.
// Rota automática: /api/datajud. Runtime Node (fetch global no Node 18+).

var BASE = "https://api-publica.datajud.cnj.jus.br";
var ALIAS_RE = /^api_publica_[a-z0-9-]+$/;
var TIMEOUT_MS = 12000;

// Chave pública vigente do DataJud. Pode ser rotacionada pelo CNJ a qualquer
// momento; nesse caso basta definir a env var DATAJUD_API_KEY no Vercel.
var FALLBACK_KEY = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

function authHeader() {
  var k = process.env.DATAJUD_API_KEY;
  return "APIKey " + (k && k.trim() ? k.trim() : FALLBACK_KEY);
}

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "metodo_nao_permitido" });
    return;
  }

  var body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  var digitos = String(body.numero || "").replace(/\D/g, "");
  var alias = String(body.alias || "");

  if (digitos.length !== 20) {
    res.status(400).json({ error: "numero_invalido" });
    return;
  }
  if (!ALIAS_RE.test(alias)) {
    res.status(400).json({ error: "alias_invalido" });
    return;
  }

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  try {
    var r = await fetch(BASE + "/" + alias + "/_search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify({ query: { match: { numeroProcesso: digitos } } }),
      signal: controller.signal,
    });

    if (!r.ok) {
      res.status(502).json({ error: "datajud_http", status: r.status });
      return;
    }

    var data = await r.json();
    var hit = data && data.hits && data.hits.hits && data.hits.hits[0] && data.hits.hits[0]._source;

    if (!hit) {
      res.status(200).json({ encontrado: false });
      return;
    }

    res.status(200).json({ encontrado: true, processo: normalizar(hit) });
  } catch (e) {
    if (e && e.name === "AbortError") {
      res.status(504).json({ error: "timeout" });
    } else {
      res.status(504).json({ error: "network" });
    }
  } finally {
    clearTimeout(timer);
  }
}
