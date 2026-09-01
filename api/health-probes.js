import { currentUser } from "../server/sso.js";
import { ssoConfigurado } from "../server/sso-config.js";
import { origemPermitida } from "../server/origin.js";
import { createHealthProbe, deleteHealthProbeForCreator, healthProbesForUser, portfolioForUser, updateHealthProbeForCreator } from "../server/db.js";

const ALIAS_RE = /^api_publica_[a-z0-9-]{1,52}$/;

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

export default async function handler(req, res) {
  if (!origemPermitida(req)) return erro(res, 403, "origem_nao_permitida");
  if (!ssoConfigurado()) return erro(res, 503, "autenticacao_indisponivel");
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "autenticacao_necessaria", login: "sso" });

  const body = corpo(req);
  const portfolioId = texto((req.query || {}).portfolioId || body.portfolioId);
  const id = texto((req.query || {}).id || body.id);
  if (!portfolioId) return erro(res, 400, "probe_invalido");

  try {
    if (req.method === "POST") {
      const alias = texto(body.alias);
      const intervaloMinutos = intervalo(body.intervaloMinutos);
      if (!ALIAS_RE.test(alias) || !intervaloMinutos) return erro(res, 400, "probe_invalido");
      const portfolio = await portfolioForUser(portfolioId, user.id);
      if (!portfolio || portfolio.papel !== "criador") return erro(res, 404, "portfolio_nao_encontrado");
      const probe = await createHealthProbe(portfolioId, user.id, { alias, intervaloMinutos });
      if (!probe) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(201).json(probe);
    }

    const portfolio = await portfolioForUser(portfolioId, user.id);
    if (!portfolio) return erro(res, 404, "portfolio_nao_encontrado");
    if (req.method === "GET") return res.status(200).json({ probes: await healthProbesForUser(portfolioId, user.id) });
    if (portfolio.papel !== "criador") return erro(res, 404, "portfolio_nao_encontrado");
    if (req.method === "PATCH") {
      const alias = body.alias === undefined ? null : texto(body.alias);
      const intervaloMinutos = intervalo(body.intervaloMinutos);
      if (!id || (alias !== null && !ALIAS_RE.test(alias)) || !intervaloMinutos) return erro(res, 400, "probe_invalido");
      const dados = alias === null ? { intervaloMinutos } : { alias, intervaloMinutos };
      const probe = await updateHealthProbeForCreator(portfolioId, id, user.id, dados);
      if (!probe) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(200).json(probe);
    }
    if (req.method === "DELETE") {
      if (!id) return erro(res, 400, "probe_invalido");
      if (!await deleteHealthProbeForCreator(portfolioId, id, user.id)) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(204).end();
    }
    return erro(res, 405, "metodo_nao_permitido");
  } catch {
    return erro(res, 503, "probe_indisponivel");
  }
}
