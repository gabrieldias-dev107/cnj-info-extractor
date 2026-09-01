import { currentUser } from "../../server/sso.js";
import { ssoConfigurado } from "../../server/sso-config.js";
import { origemPermitida } from "../../server/origin.js";
import { createPortfolio, deletePortfolioForCreator, portfoliosForUser, updatePortfolioForCreator } from "../../server/db.js";

function erro(res, status, codigo) {
  return res.status(status).json({ error: codigo });
}

function corpo(req) {
  if (typeof req.body !== "string") return req.body || {};
  try { return JSON.parse(req.body); } catch { return {}; }
}

function texto(valor) {
  return String(valor || "").trim();
}

async function usuarioAutorizado(req, res) {
  if (!origemPermitida(req)) {
    erro(res, 403, "origem_nao_permitida");
    return null;
  }
  if (!ssoConfigurado()) {
    erro(res, 503, "autenticacao_indisponivel");
    return null;
  }
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: "autenticacao_necessaria", login: "sso" });
    return null;
  }
  return user;
}

export default async function handler(req, res) {
  const user = await usuarioAutorizado(req, res);
  if (!user) return;
  const body = corpo(req);
  const id = texto((req.query || {}).id || body.id);

  try {
    if (req.method === "GET") return res.status(200).json({ portfolios: await portfoliosForUser(user.id) });
    if (req.method === "POST") {
      const nome = texto(body.nome);
      if (!nome) return erro(res, 400, "portfolio_invalido");
      const portfolio = await createPortfolio(user.id, { nome });
      return res.status(201).json(portfolio);
    }
    if (req.method === "PATCH") {
      const nome = texto(body.nome);
      if (!id || !nome) return erro(res, 400, "portfolio_invalido");
      const portfolio = await updatePortfolioForCreator(id, user.id, { nome });
      if (!portfolio) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(200).json(portfolio);
    }
    if (req.method === "DELETE") {
      if (!id) return erro(res, 400, "portfolio_invalido");
      if (!await deletePortfolioForCreator(id, user.id)) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(204).end();
    }
    return erro(res, 405, "metodo_nao_permitido");
  } catch {
    return erro(res, 503, "portfolio_indisponivel");
  }
}
