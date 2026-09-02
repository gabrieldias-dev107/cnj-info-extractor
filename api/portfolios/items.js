import { currentUser } from "../../server/sso.js";
import { ssoConfigurado } from "../../server/sso-config.js";
import { origemPermitida } from "../../server/origin.js";
import { createPortfolioItem, deletePortfolioItemForCreator, portfolioForUser, portfolioItemsForUser, updatePortfolioItemForCreator } from "../../server/db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INTERVALO_MINUTOS = 1440;

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

function uuid(valor) {
  const id = texto(valor);
  return UUID_RE.test(id) ? id : null;
}

function intervalo(valor) {
  return typeof valor === "number" && Number.isFinite(valor) && Number.isInteger(valor) && valor > 0 && valor <= MAX_INTERVALO_MINUTOS ? valor : null;
}

function itemPublico(item) {
  const publico = { id: item.id };
  if (item.process_id !== undefined) publico.processId = item.process_id;
  if (item.numero !== undefined) publico.numero = item.numero;
  if (item.alias !== undefined) publico.alias = item.alias;
  if (item.intervalo_minutos !== undefined) publico.intervaloMinutos = item.intervalo_minutos;
  if (item.proxima_consulta_em !== undefined) publico.proximaConsultaEm = item.proxima_consulta_em;
  return publico;
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
  const portfolioId = uuid((req.query || {}).portfolioId || body.portfolioId);
  const id = uuid((req.query || {}).id || body.id);
  if (!portfolioId) return erro(res, 400, "portfolio_invalido");

  try {
    if (req.method === "POST") {
      const processId = uuid(body.processId);
      const intervaloMinutos = intervalo(body.intervaloMinutos);
      if (!processId || !intervaloMinutos) return erro(res, 400, "item_invalido");
      const portfolio = await portfolioForUser(portfolioId, user.id);
      if (!portfolio || portfolio.papel !== "criador") return erro(res, 404, "portfolio_nao_encontrado");
      const item = await createPortfolioItem(portfolioId, user.id, { processId, intervaloMinutos });
      if (!item) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(201).json(itemPublico(item));
    }
    if (req.method === "PATCH") {
      const intervaloMinutos = intervalo(body.intervaloMinutos);
      if (!id || !intervaloMinutos) return erro(res, 400, "item_invalido");
      const portfolio = await portfolioForUser(portfolioId, user.id);
      if (!portfolio || portfolio.papel !== "criador") return erro(res, 404, "portfolio_nao_encontrado");
      const item = await updatePortfolioItemForCreator(portfolioId, id, user.id, { intervaloMinutos });
      if (!item) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(200).json(itemPublico(item));
    }
    if (req.method === "DELETE") {
      if (!id) return erro(res, 400, "item_invalido");
      const portfolio = await portfolioForUser(portfolioId, user.id);
      if (!portfolio || portfolio.papel !== "criador") return erro(res, 404, "portfolio_nao_encontrado");
      if (!await deletePortfolioItemForCreator(portfolioId, id, user.id)) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(204).end();
    }
    if (req.method !== "GET") return erro(res, 405, "metodo_nao_permitido");
    const portfolio = await portfolioForUser(portfolioId, user.id);
    if (!portfolio) return erro(res, 404, "portfolio_nao_encontrado");
    return res.status(200).json({ itens: (await portfolioItemsForUser(portfolioId, user.id)).map(itemPublico) });
  } catch {
    return erro(res, 503, "portfolio_indisponivel");
  }
}
