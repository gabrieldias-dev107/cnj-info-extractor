import { currentUser } from "../sso.js";
import { ssoConfigurado } from "../sso-config.js";
import { origemPermitida } from "../origin.js";
import { createHealthProbe, deleteHealthProbeForCreator, healthProbesForUser, portfolioForUser, updateHealthProbeForCreator } from "../db.js";
import { validarNumeroParaConsulta } from "../cnj-validation.js";

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

// O alias NUNCA vem do cliente: quem escolhe o índice do DataJud é o servidor,
// derivando-o do número informado pelo criador — a mesma regra da consulta
// manual em `api/datajud.js`. Um alias no corpo é simplesmente ignorado.
function probeConfigurado(valor) {
  const validacao = validarNumeroParaConsulta(valor);
  return validacao.valido ? { numero: validacao.numero, alias: validacao.alias } : null;
}

function probePublico(probe) {
  const publico = { id: probe.id };
  if (probe.numero !== undefined) publico.numero = probe.numero;
  if (probe.alias !== undefined) publico.alias = probe.alias;
  if (probe.intervalo_minutos !== undefined) publico.intervaloMinutos = probe.intervalo_minutos;
  if (probe.proxima_consulta_em !== undefined) publico.proximaConsultaEm = probe.proxima_consulta_em;
  return publico;
}

export default async function handler(req, res) {
  if (!origemPermitida(req)) return erro(res, 403, "origem_nao_permitida");
  if (!ssoConfigurado()) return erro(res, 503, "autenticacao_indisponivel");
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: "autenticacao_necessaria", login: "sso" });

  const body = corpo(req);
  const portfolioId = uuid((req.query || {}).portfolioId || body.portfolioId);
  const id = uuid((req.query || {}).id || body.id);
  if (!portfolioId) return erro(res, 400, "probe_invalido");

  try {
    if (req.method === "POST") {
      const configurado = probeConfigurado(body.numero);
      const intervaloMinutos = intervalo(body.intervaloMinutos);
      if (!configurado || !intervaloMinutos) return erro(res, 400, "probe_invalido");
      const portfolio = await portfolioForUser(portfolioId, user.id);
      if (!portfolio || portfolio.papel !== "criador") return erro(res, 404, "portfolio_nao_encontrado");
      const probe = await createHealthProbe(portfolioId, user.id, { ...configurado, intervaloMinutos });
      if (!probe) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(201).json(probePublico(probe));
    }
    if (req.method === "PATCH") {
      const configurado = body.numero === undefined ? null : probeConfigurado(body.numero);
      const intervaloMinutos = intervalo(body.intervaloMinutos);
      if (!id || (body.numero !== undefined && !configurado) || !intervaloMinutos) return erro(res, 400, "probe_invalido");
      const portfolio = await portfolioForUser(portfolioId, user.id);
      if (!portfolio || portfolio.papel !== "criador") return erro(res, 404, "portfolio_nao_encontrado");
      const dados = configurado === null ? { intervaloMinutos } : { ...configurado, intervaloMinutos };
      const probe = await updateHealthProbeForCreator(portfolioId, id, user.id, dados);
      if (!probe) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(200).json(probePublico(probe));
    }
    if (req.method === "DELETE") {
      if (!id) return erro(res, 400, "probe_invalido");
      const portfolio = await portfolioForUser(portfolioId, user.id);
      if (!portfolio || portfolio.papel !== "criador") return erro(res, 404, "portfolio_nao_encontrado");
      if (!await deleteHealthProbeForCreator(portfolioId, id, user.id)) return erro(res, 404, "portfolio_nao_encontrado");
      return res.status(204).end();
    }
    if (req.method !== "GET") return erro(res, 405, "metodo_nao_permitido");
    const portfolio = await portfolioForUser(portfolioId, user.id);
    if (!portfolio) return erro(res, 404, "portfolio_nao_encontrado");
    return res.status(200).json({ probes: (await healthProbesForUser(portfolioId, user.id)).map(probePublico) });
  } catch {
    return erro(res, 503, "probe_indisponivel");
  }
}
