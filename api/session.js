import { autenticacaoConfigurada, cookieSessao, cookieSessaoExpirada, criarTokenSessao, senhaValida, sessaoValida } from "../server/auth.js";
import { origemPermitida } from "../server/origin.js";
import { consumirLogin } from "../server/rate-limit.js";

function erro(res, status, codigo, retryAfter) {
  if (retryAfter) res.setHeader("Retry-After", String(retryAfter));
  return res.status(status).json({ error: codigo });
}

export default async function handler(req, res) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST", "DELETE"].includes(req.method)) return erro(res, 405, "metodo_nao_permitido");
  if (!origemPermitida(req)) return erro(res, 403, "origem_nao_permitida");

  if (req.method === "GET") {
    return sessaoValida(req) ? res.status(204).end() : erro(res, 401, "autenticacao_necessaria");
  }
  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", cookieSessaoExpirada(req));
    return res.status(204).end();
  }
  if (!autenticacaoConfigurada()) return erro(res, 503, "autenticacao_indisponivel");

  var limite = await consumirLogin(req);
  if (limite.indisponivel) return erro(res, 503, "autenticacao_indisponivel");
  if (!limite.permitido) return erro(res, 429, "limite_excedido", limite.retryAfter);

  var body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  if (!senhaValida(body && body.senha)) return erro(res, 401, "credenciais_invalidas");
  var token = criarTokenSessao();
  res.setHeader("Set-Cookie", cookieSessao(req, token));
  return res.status(204).end();
}
