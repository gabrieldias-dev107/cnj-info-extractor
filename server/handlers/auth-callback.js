import { finishLogin } from "../sso.js";
export default async function handler(req, res) { try { const login = await finishLogin(req, req.query || {}); res.setHeader("Set-Cookie", [login.cookie, "cnj_oidc=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"]); res.redirect(302, "/"); } catch (error) { res.status(error.message === "acesso_nao_permitido" ? 403 : 401).json({ error: error.message }); } }
