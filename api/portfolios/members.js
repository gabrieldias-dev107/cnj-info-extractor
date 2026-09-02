import { currentUser } from "../../server/sso.js";
import { ssoConfigurado } from "../../server/sso-config.js";
import { origemPermitida } from "../../server/origin.js";
import { addPortfolioMemberForCreator, deletePortfolioMemberForCreator, portfolioForUser, portfolioMembersForUser } from "../../server/db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function membroPublico(membro) {
  const publico = { id: membro.id, email: membro.email };
  if (membro.created_at !== undefined) publico.createdAt = membro.created_at;
  if (membro.expires_at !== undefined) publico.expiresAt = membro.expires_at;
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
  const memberId = uuid((req.query || {}).userId || body.userId);
  if (!portfolioId) return erro(res, 400, "portfolio_invalido");

  try {
    if (req.method === "DELETE" && !memberId) return erro(res, 400, "membro_invalido");
    const portfolio = await portfolioForUser(portfolioId, user.id);
    if (!portfolio) return erro(res, 404, "portfolio_nao_encontrado");
    if (req.method === "GET") return res.status(200).json({ membros: (await portfolioMembersForUser(portfolioId, user.id)).map(membroPublico) });
    if (portfolio.papel !== "criador") return erro(res, 404, "portfolio_nao_encontrado");
    if (req.method === "POST") {
      const email = texto(body.email).toLowerCase();
      if (!email || !email.includes("@")) return erro(res, 400, "membro_invalido");
      const membro = await addPortfolioMemberForCreator(portfolioId, user.id, { email });
      if (!membro) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(201).json(membroPublico(membro));
    }
    if (req.method === "DELETE") {
      if (!await deletePortfolioMemberForCreator(portfolioId, memberId, user.id)) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(204).end();
    }
    return erro(res, 405, "metodo_nao_permitido");
  } catch {
    return erro(res, 503, "portfolio_indisponivel");
  }
}
