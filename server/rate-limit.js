import { createHmac } from "node:crypto";

var JANELA_MIN_S = 60;
var JANELA_DIA_S = 86400;
var JANELA_LOGIN_S = 15 * 60;

function num(v, padrao) {
  var n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function ipCliente(req) {
  var xff = req.headers && req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  var real = req.headers && req.headers["x-real-ip"];
  return typeof real === "string" && real.trim() ? real.trim() : "desconhecido";
}

export function identificarCliente(req) {
  var segredo = String(process.env.SESSION_SECRET || "rate-limit-sem-segredo");
  return createHmac("sha256", segredo).update("ip:" + ipCliente(req), "utf8").digest("hex");
}

function bucket(prefixo, segundos, agoraMs) {
  return prefixo + ":" + Math.floor(agoraMs / (segundos * 1000));
}

async function incrementar(url, token, chaves) {
  var comandos = [];
  chaves.forEach(function (chave) {
    comandos.push(["INCR", chave.nome]);
    comandos.push(["EXPIRE", chave.nome, String(chave.ttl), "NX"]);
  });
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, num(process.env.RL_REDIS_TIMEOUT_MS, 3000));
  var resposta;
  try {
    resposta = await fetch(url.replace(/\/+$/, "") + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(comandos),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resposta.ok) throw new Error("upstash_http_" + resposta.status);
  var itens = await resposta.json();
  if (!Array.isArray(itens) || itens.length !== comandos.length) throw new Error("upstash_resposta_invalida");
  itens.forEach(function (item) {
    if (!item || item.error || !("result" in item)) throw new Error("upstash_comando_falhou");
  });
  return chaves.map(function (chave, i) {
    var contagem = Number(itens[i * 2].result);
    if (!Number.isFinite(contagem)) throw new Error("upstash_contagem_invalida");
    return { ...chave, contagem: contagem };
  });
}

function restante(ttl, agoraMs) {
  var ms = ttl * 1000;
  return Math.max(1, Math.ceil((ms - (agoraMs % ms)) / 1000));
}

async function consumir(chaves, agoraMs, falhaAberta) {
  var url = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { permitido: falhaAberta, indisponivel: true, motivo: "upstash_nao_configurado" };
  var resultados;
  try { resultados = await incrementar(url, token, chaves); }
  catch (e) { return { permitido: falhaAberta, indisponivel: true, motivo: (e && e.message) || "upstash_falhou" }; }
  for (var i = 0; i < resultados.length; i++) {
    if (Number.isFinite(resultados[i].contagem) && resultados[i].contagem > resultados[i].limite) {
      return { permitido: false, escopo: resultados[i].escopo, limite: resultados[i].limite, retryAfter: restante(resultados[i].ttl, agoraMs) };
    }
  }
  return { permitido: true };
}

export function consumirDatajud(req, agoraMs = Date.now()) {
  var cliente = identificarCliente(req);
  return consumir([
    { nome: bucket("rl:datajud:cli:" + cliente, JANELA_MIN_S, agoraMs), ttl: JANELA_MIN_S, limite: num(process.env.RL_CLIENTE_MIN, 30), escopo: "cliente_minuto" },
    { nome: bucket("rl:datajud:glb:min", JANELA_MIN_S, agoraMs), ttl: JANELA_MIN_S, limite: num(process.env.RL_GLOBAL_MIN, 300), escopo: "global_minuto" },
    { nome: bucket("rl:datajud:glb:dia", JANELA_DIA_S, agoraMs), ttl: JANELA_DIA_S, limite: num(process.env.RL_GLOBAL_DIA, 2000), escopo: "global_dia" },
  ], agoraMs, true);
}

export function consumirLogin(req, agoraMs = Date.now()) {
  var cliente = identificarCliente(req);
  return consumir([
    { nome: bucket("rl:login:cli:" + cliente, JANELA_LOGIN_S, agoraMs), ttl: JANELA_LOGIN_S, limite: num(process.env.RL_LOGIN_15MIN, 10), escopo: "login_cliente" },
  ], agoraMs, false);
}
