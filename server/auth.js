import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { conexaoSegura } from "./origin.js";

export const COOKIE_SESSAO = "cnj_session";
export const DURACAO_SESSAO_S = 8 * 60 * 60;

function configuracao() {
  var senha = String(process.env.APP_ACCESS_PASSWORD || "");
  var segredo = String(process.env.SESSION_SECRET || "");
  if (senha.length < 16 || segredo.length < 32) return null;
  return { senha: senha, segredo: segredo };
}

function digest(valor) {
  return createHash("sha256").update(String(valor), "utf8").digest();
}

export function senhaValida(senha) {
  var config = configuracao();
  if (!config || typeof senha !== "string") return false;
  return timingSafeEqual(digest(senha), digest(config.senha));
}

function assinatura(payload, segredo) {
  return createHmac("sha256", segredo).update(payload, "utf8").digest("base64url");
}

export function criarTokenSessao(agoraMs = Date.now()) {
  var config = configuracao();
  if (!config) return null;
  var expira = Math.floor(agoraMs / 1000) + DURACAO_SESSAO_S;
  var payload = "v1." + expira + "." + randomBytes(16).toString("base64url");
  return payload + "." + assinatura(payload, config.segredo);
}

function cookies(req) {
  var bruto = String((req.headers && req.headers.cookie) || "");
  var saida = {};
  bruto.split(";").forEach(function (parte) {
    var i = parte.indexOf("=");
    if (i > 0) saida[parte.slice(0, i).trim()] = parte.slice(i + 1).trim();
  });
  return saida;
}

export function sessaoValida(req, agoraMs = Date.now()) {
  var config = configuracao();
  var token = cookies(req)[COOKIE_SESSAO];
  if (!config || !token) return false;
  var partes = token.split(".");
  if (partes.length !== 4 || partes[0] !== "v1") return false;
  var expira = Number(partes[1]);
  if (!Number.isSafeInteger(expira) || expira <= Math.floor(agoraMs / 1000)) return false;
  var payload = partes.slice(0, 3).join(".");
  var recebida;
  try { recebida = Buffer.from(partes[3], "base64url"); } catch (e) { return false; }
  var esperada = Buffer.from(assinatura(payload, config.segredo), "base64url");
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}

function atributos(req, maxAge) {
  return "HttpOnly; SameSite=Strict; Path=/api; Max-Age=" + maxAge + (conexaoSegura(req) ? "; Secure" : "");
}

export function cookieSessao(req, token) {
  return COOKIE_SESSAO + "=" + token + "; " + atributos(req, DURACAO_SESSAO_S);
}

export function cookieSessaoExpirada(req) {
  return COOKIE_SESSAO + "=; " + atributos(req, 0);
}

export function autenticacaoConfigurada() {
  return Boolean(configuracao());
}
