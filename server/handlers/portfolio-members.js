import { currentUser } from "../sso.js";
import { ssoConfigurado } from "../sso-config.js";
import { origemPermitida } from "../origin.js";
import { addPortfolioMemberForCreator, deletePortfolioMemberForCreator, portfolioForUser, portfolioMembersForUser } from "../db.js";
import { auditar, atorUsuario } from "../audit.js";

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

  // Incluir ou remover membro é conceder ou retirar acesso a dado processual de
  // terceiro — o evento de acesso mais sensível do P1. O recurso registrado é a
  // carteira, nunca o e-mail do convidado.
  const auditarMembro = (acao, resultado) => auditar(Object.assign({}, atorUsuario(user), {
    acao, recurso: "portfolio:" + portfolioId, resultado, reqId: (req.headers && typeof req.headers["x-vercel-id"] === "string") ? req.headers["x-vercel-id"] : null,
  }));

  try {
    if (req.method === "DELETE" && !memberId) return erro(res, 400, "membro_invalido");
    const portfolio = await portfolioForUser(portfolioId, user.id);
    if (!portfolio) {
      await auditarMembro("portfolio_membros", "negado_nao_encontrado");
      return erro(res, 404, "portfolio_nao_encontrado");
    }
    if (req.method === "GET") return res.status(200).json({ membros: (await portfolioMembersForUser(portfolioId, user.id)).map(membroPublico) });
    if (portfolio.papel !== "criador") {
      // Membro que tenta administrar recebe o mesmo 404 de quem não tem vínculo.
      await auditarMembro("portfolio_membros", "negado_nao_criador");
      return erro(res, 404, "portfolio_nao_encontrado");
    }
    if (req.method === "POST") {
      const email = texto(body.email).toLowerCase();
      if (!email || !email.includes("@")) return erro(res, 400, "membro_invalido");
      const membro = await addPortfolioMemberForCreator(portfolioId, user.id, { email });
      if (!membro) {
        await auditarMembro("membro_concedido", "negado_nao_encontrado");
        return erro(res, 404, "portfolio_nao_encontrado");
      }
      await auditarMembro("membro_concedido", "sucesso");
      return res.status(201).json(membroPublico(membro));
    }
    if (req.method === "DELETE") {
      if (!await deletePortfolioMemberForCreator(portfolioId, memberId, user.id)) {
        await auditarMembro("membro_removido", "negado_nao_encontrado");
        return erro(res, 404, "portfolio_nao_encontrado");
      }
      await auditarMembro("membro_removido", "sucesso");
      return res.status(204).end();
    }
    return erro(res, 405, "metodo_nao_permitido");
  } catch {
    return erro(res, 503, "portfolio_indisponivel");
  }
}
