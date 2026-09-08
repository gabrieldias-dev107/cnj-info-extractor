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

async function chamarPipeline(url, token, comandos) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, num(process.env.RL_REDIS_TIMEOUT_MS, 3000));
  var itens;
  try {
    var resposta = await fetch(url.replace(/\/+$/, "") + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(comandos),
      signal: controller.signal,
    });
    if (!resposta.ok) throw new Error("upstash_http_" + resposta.status);
    itens = await resposta.json();
  } finally {
    clearTimeout(timer);
  }
  if (!Array.isArray(itens) || itens.length !== comandos.length) throw new Error("upstash_resposta_invalida");
  itens.forEach(function (item) {
    if (!item || item.error || !("result" in item)) throw new Error("upstash_comando_falhou");
  });
  return itens;
}

// Exposto para o circuito por alias da automação P1 reusar a mesma chamada
// REST (URL, token, timeout e validação do pipeline) em vez de abrir outro
// cliente HTTP. Nunca decide sozinho: quem chama define o que fazer quando
// `ok` é falso.
export async function executarPipeline(comandos) {
  // A integração Upstash da Vercel usa nomes KV; instalações manuais usam
  // os nomes REST históricos. Aceitar ambos evita copiar segredo entre vars.
  var url = process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_KV_REST_API_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
  if (!url || !token) return { ok: false, motivo: "upstash_nao_configurado" };
  try { return { ok: true, resultados: await chamarPipeline(url, token, comandos) }; }
  catch (e) { return { ok: false, motivo: (e && e.message) || "upstash_falhou" }; }
}

async function incrementar(chaves) {
  var comandos = [];
  chaves.forEach(function (chave) {
    comandos.push(["INCR", chave.nome]);
    comandos.push(["EXPIRE", chave.nome, String(chave.ttl), "NX"]);
  });
  var pipeline = await executarPipeline(comandos);
  if (!pipeline.ok) throw new Error(pipeline.motivo);
  return chaves.map(function (chave, i) {
    var contagem = Number(pipeline.resultados[i * 2].result);
    if (!Number.isFinite(contagem)) throw new Error("upstash_contagem_invalida");
    return { ...chave, contagem: contagem };
  });
}

function restante(ttl, agoraMs) {
  var ms = ttl * 1000;
  return Math.max(1, Math.ceil((ms - (agoraMs % ms)) / 1000));
}

async function consumir(chaves, agoraMs, falhaAberta) {
  var resultados;
  try { resultados = await incrementar(chaves); }
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

// A automação reserva 600 chamadas diárias ao DataJud: 480 de monitoramento e
// 120 de saúde. Diferente de `consumirDatajud` (tráfego manual, fail-open por
// desenho), estes contadores falham fechados: Redis fora do ar ou malformado
// bloqueia a automação em vez de liberar chamada não contabilizada.
export function consumirMonitoramento(agoraMs = Date.now()) {
  return consumir([
    { nome: bucket("rl:auto:monitoramento:dia", JANELA_DIA_S, agoraMs), ttl: JANELA_DIA_S, limite: num(process.env.RL_MONITORAMENTO_DIA, 480), escopo: "monitoramento_dia" },
  ], agoraMs, false);
}

export function consumirSaude(agoraMs = Date.now()) {
  return consumir([
    { nome: bucket("rl:auto:saude:dia", JANELA_DIA_S, agoraMs), ttl: JANELA_DIA_S, limite: num(process.env.RL_SAUDE_DIA, 120), escopo: "saude_dia" },
  ], agoraMs, false);
}

// Cota da API interna, por token de serviço. Fail-closed como a automação, e
// pelo mesmo motivo invertido: consumo externo não pode furar a cota da
// operação quando o Redis cai. `limiteDia` vem do próprio token; o teto por
// minuto é global e existe para conter rajada.
export function consumirTokenServico(tokenId, limiteDia, agoraMs = Date.now()) {
  const id = String(tokenId || "desconhecido");
  const dia = num(limiteDia, num(process.env.RL_API_TOKEN_DIA, 1000));
  return consumir([
    { nome: bucket("rl:api:token:" + id + ":min", JANELA_MIN_S, agoraMs), ttl: JANELA_MIN_S, limite: num(process.env.RL_API_TOKEN_MIN, 60), escopo: "token_minuto" },
    { nome: bucket("rl:api:token:" + id + ":dia", JANELA_DIA_S, agoraMs), ttl: JANELA_DIA_S, limite: dia, escopo: "token_dia" },
  ], agoraMs, false);
}

export function consumirLogin(req, agoraMs = Date.now()) {
  var cliente = identificarCliente(req);
  return consumir([
    { nome: bucket("rl:login:cli:" + cliente, JANELA_LOGIN_S, agoraMs), ttl: JANELA_LOGIN_S, limite: num(process.env.RL_LOGIN_15MIN, 10), escopo: "login_cliente" },
  ], agoraMs, false);
}
