import { currentUser } from "../../server/sso.js";
import { ssoConfigurado } from "../../server/sso-config.js";
import { origemPermitida } from "../../server/origin.js";
import { createPortfolioItem, deletePortfolioItemForCreator, portfolioForUser, portfolioItemsForUser, updatePortfolioItemForCreator } from "../../server/db.js";

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

function intervalo(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
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
  const portfolioId = texto((req.query || {}).portfolioId || body.portfolioId);
  const id = texto((req.query || {}).id || body.id);
  if (!portfolioId) return erro(res, 400, "portfolio_invalido");

  try {
    const portfolio = await portfolioForUser(portfolioId, user.id);
    if (!portfolio) return erro(res, 404, "portfolio_nao_encontrado");
    if (req.method === "GET") return res.status(200).json({ itens: await portfolioItemsForUser(portfolioId, user.id) });
    if (portfolio.papel !== "criador") return erro(res, 404, "portfolio_nao_encontrado");
    if (req.method === "POST") {
      const processId = texto(body.processId);
      const intervaloMinutos = intervalo(body.intervaloMinutos);
      if (!processId || !intervaloMinutos) return erro(res, 400, "item_invalido");
      const item = await createPortfolioItem(portfolioId, user.id, { processId, intervaloMinutos });
      if (!item) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(201).json(item);
    }
    if (req.method === "PATCH") {
      const intervaloMinutos = intervalo(body.intervaloMinutos);
      if (!id || !intervaloMinutos) return erro(res, 400, "item_invalido");
      const item = await updatePortfolioItemForCreator(portfolioId, id, user.id, { intervaloMinutos });
      if (!item) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(200).json(item);
    }
    if (req.method === "DELETE") {
      if (!id) return erro(res, 400, "item_invalido");
      if (!await deletePortfolioItemForCreator(portfolioId, id, user.id)) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(204).end();
    }
    return erro(res, 405, "metodo_nao_permitido");
  } catch {
    return erro(res, 503, "portfolio_indisponivel");
  }
}
