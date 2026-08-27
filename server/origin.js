function header(req, nome) {
  var valor = req && req.headers && req.headers[nome];
  if (Array.isArray(valor)) return valor[0];
  return typeof valor === "string" ? valor : "";
}

export function origemPermitida(req) {
  var origin = header(req, "origin");
  if (!origin) return header(req, "sec-fetch-site") === "same-origin";

  var host;
  try { host = new URL(origin).host; } catch (e) { return false; }
  return Boolean(host && host === header(req, "host"));
}

export function conexaoSegura(req) {
  return header(req, "x-forwarded-proto").split(",")[0].trim() === "https" || process.env.VERCEL === "1";
}
