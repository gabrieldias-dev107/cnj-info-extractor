import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { createSession, deleteSession, userForSession, upsertUser } from "./db.js";
import { configuracaoSso, segredoSessaoSso, ssoConfigurado } from "./sso-config.js";

export const COOKIE_SESSAO_SSO = "cnj_sso";
const DURACAO_S = 8 * 60 * 60;
function env(nome) { return String(process.env[nome] || "").trim(); }
function baseUrl(req) { return env("APP_BASE_URL") || (req.headers["x-forwarded-proto"] || "https") + "://" + req.headers.host; }
function cookies(req) { return String(req.headers.cookie || "").split(";").reduce((out, part) => { const [key, ...value] = part.trim().split("="); if (key) out[key] = value.join("="); return out; }, {}); }
function attrs(req, maxAge) { return "HttpOnly; SameSite=Lax; Path=/; Max-Age=" + maxAge + ((req.headers["x-forwarded-proto"] === "https" || process.env.VERCEL === "1") ? "; Secure" : ""); }
function config(req) { const { tenantId, clientId, clientSecret } = configuracaoSso(); if (!ssoConfigurado()) throw new Error("autenticacao_indisponivel"); return { auth: { clientId, authority: "https://login.microsoftonline.com/" + tenantId, clientSecret }, redirectUri: baseUrl(req) + "/api/auth/callback", tenantId }; }
function assinatura(valor) { return createHmac("sha256", segredoSessaoSso()).update(valor, "utf8").digest("base64url"); }
export function criarStateCookie(req, state, verifier) { const value = Buffer.from(JSON.stringify({ state, verifier, exp: Date.now() + 600000 })).toString("base64url"); return "cnj_oidc=v1." + value + "." + assinatura("v1." + value) + "; " + attrs(req, 600); }
export function lerStateCookie(req) { const salvo = cookies(req).cnj_oidc || ""; const partes = salvo.split("."); if (partes.length !== 3 || partes[0] !== "v1" || !segredoSessaoSso()) throw new Error("autenticacao_invalida"); const recebido = Buffer.from(partes[2], "base64url"); const esperado = Buffer.from(assinatura(partes.slice(0, 2).join(".")), "base64url"); if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) throw new Error("autenticacao_invalida"); try { return JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8")); } catch { throw new Error("autenticacao_invalida"); } }

export async function startLogin(req) {
  const cfg = config(req); const app = new ConfidentialClientApplication({ auth: cfg.auth }); const state = randomBytes(24).toString("base64url"); const verifier = randomBytes(48).toString("base64url"); const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = await app.getAuthCodeUrl({ scopes: ["openid", "profile", "email"], redirectUri: cfg.redirectUri, state, codeChallenge: challenge, codeChallengeMethod: "S256" });
  return { url, cookie: criarStateCookie(req, state, verifier) };
}
export async function finishLogin(req, { code, state }) {
  const values = lerStateCookie(req);
  if (!code || !state || values.state !== state || values.exp < Date.now()) throw new Error("autenticacao_invalida");
  const cfg = config(req); const app = new ConfidentialClientApplication({ auth: cfg.auth }); const result = await app.acquireTokenByCode({ code, scopes: ["openid", "profile", "email"], redirectUri: cfg.redirectUri, codeVerifier: values.verifier }); const claims = result.idTokenClaims || {}; const email = String(claims.preferred_username || claims.email || "").toLowerCase();
  if (String(claims.tid || "") !== cfg.tenantId || !email.endsWith("@btblue.com.br") || !claims.oid) throw new Error("acesso_nao_permitido");
  const user = await upsertUser({ oid: String(claims.oid), email }); const token = randomBytes(32).toString("base64url"); await createSession(user.id, token, new Date(Date.now() + DURACAO_S * 1000)); return { user, cookie: COOKIE_SESSAO_SSO + "=" + token + "; " + attrs(req, DURACAO_S) };
}
export async function currentUser(req) { return userForSession(cookies(req)[COOKIE_SESSAO_SSO]); }
export async function logout(req) { const token = cookies(req)[COOKIE_SESSAO_SSO]; if (token) await deleteSession(token); return COOKIE_SESSAO_SSO + "=; " + attrs(req, 0); }
