import { startLogin } from "../../../server/sso.js";
export default async function handler(req, res) { try { const login = await startLogin(req); res.setHeader("Set-Cookie", login.cookie); res.redirect(302, login.url); } catch (error) { res.status(503).json({ error: error.message }); } }
