// Administração dos tokens de serviço da API interna.
//
// Modelo criador, igual às carteiras: cada usuário SSO emite, lista e revoga
// somente os próprios tokens. Não existe papel de administrador global.
//
// Rota de sessão: mantém a cadeia canônica `origemPermitida` → `ssoConfigurado`
// → `currentUser` e RECUSA `Authorization: Bearer`. Um token de serviço não
// pode emitir nem revogar outro token — senão um vazamento se autorrenovaria.
import { auditar, atorUsuario } from "../audit.js";
import { createServiceToken, revokeServiceTokenForCreator, serviceTokensForCreator } from "../db.js";
import { currentUser } from "../sso.js";
import { origemPermitida } from "../origin.js";
import { ssoConfigurado } from "../sso-config.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_DIA_MAXIMO = 10000;

function erro(res, status, codigo) {
  return res.status(status).json({ error: codigo });
}

// `JSON.parse("null")` devolve null, e ler campo de null derruba o handler antes
// de qualquer resposta. Só objeto não nulo passa.
function corpo(req) {
  const bruto = typeof req.body === "string" ? tentarJson(req.body) : req.body;
  return bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {};
}

function tentarJson(texto) {
  try { return JSON.parse(texto); } catch { return null; }
}

function temBearer(req) {
  const cabecalho = (req.headers && req.headers.authorization) || "";
  return /^Bearer\s+\S+/i.test(String(Array.isArray(cabecalho) ? cabecalho[0] : cabecalho));
}

function reqId(req) {
  const valor = req.headers && req.headers["x-vercel-id"];
  return typeof valor === "string" ? valor : null;
}

// Só número JSON inteiro, como o intervalo de monitoramento do P1: aceitar
// "500" abriria espaço para "500abc" virar 500 em algum cliente.
function limiteDiaValido(valor) {
  if (valor === undefined || valor === null) {
    const padrao = Number(process.env.RL_API_TOKEN_DIA);
    return Number.isInteger(padrao) && padrao > 0 ? padrao : 1000;
  }
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0 && valor <= LIMITE_DIA_MAXIMO ? valor : null;
}

function tokenPublico(token) {
  return {
    id: token.id,
    nome: token.nome,
    prefixo: token.prefixo,
    limiteDia: Number(token.limite_dia),
    criadoEm: token.criado_em,
    ultimoUsoEm: token.ultimo_uso_em || null,
    revogadoEm: token.revogado_em || null,
    expiresAt: token.expires_at,
  };
}

export default async function handler(req, res) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");

  // Recusa antes de haver identidade: ator anônimo. Sem estes registros a
  // trilha só teria sucessos e o 404 de revogação, o que não serve para
  // conformidade. Só grava no modo interno, onde existe banco.
  const auditarRecusa = (resultado) => (ssoConfigurado()
    ? auditar({ actorType: "usuario", userId: null, atorRotulo: "anonimo", acao: "service_tokens", recurso: null, resultado, reqId: reqId(req) })
    : Promise.resolve());

  if (!origemPermitida(req)) {
    await auditarRecusa("negado_origem");
    return erro(res, 403, "origem_nao_permitida");
  }
  if (!ssoConfigurado()) return erro(res, 503, "autenticacao_indisponivel");
  // Mecanismo único por rota: apresentar Bearer aqui é sempre erro de chamador.
  if (temBearer(req)) {
    await auditarRecusa("negado_bearer_em_rota_de_sessao");
    return res.status(401).json({ error: "autenticacao_necessaria", login: "sso" });
  }

  const user = await currentUser(req);
  if (!user) {
    await auditarRecusa("negado_sem_sessao");
    return res.status(401).json({ error: "autenticacao_necessaria", login: "sso" });
  }
  const ator = atorUsuario(user);

  try {
    if (req.method === "GET") {
      return res.status(200).json({ tokens: (await serviceTokensForCreator(user.id)).map(tokenPublico) });
    }

    if (req.method === "POST") {
      const body = corpo(req);
      const nome = String(body.nome || "").trim();
      if (!nome || nome.length > 120) return erro(res, 400, "nome_invalido");
      const limiteDia = limiteDiaValido(body.limiteDia);
      if (limiteDia === null) return erro(res, 400, "limite_invalido");

      const criado = await createServiceToken(user.id, { nome, limiteDia });
      if (!criado) return erro(res, 503, "token_indisponivel");
      await auditar(Object.assign({}, ator, {
        acao: "service_token_emitido", recurso: "t_" + criado.prefixo, resultado: "sucesso", reqId: reqId(req),
      }));
      // `token` aparece aqui e em lugar nenhum mais: o banco guarda só o hash.
      return res.status(201).json(Object.assign(tokenPublico(criado), { token: criado.token }));
    }

    if (req.method === "DELETE") {
      const id = String((req.query || {}).id || corpo(req).id || "").trim();
      if (!UUID_RE.test(id)) return erro(res, 400, "token_invalido");
      const revogado = await revokeServiceTokenForCreator(id, user.id);
      if (!revogado) {
        // Token de outro criador é indistinguível de inexistente.
        await auditar(Object.assign({}, ator, {
          acao: "service_token_revogado", recurso: "id_nao_autorizado", resultado: "negado_nao_encontrado", reqId: reqId(req),
        }));
        return erro(res, 404, "token_nao_encontrado");
      }
      await auditar(Object.assign({}, ator, {
        acao: "service_token_revogado", recurso: "t_" + revogado.prefixo, resultado: "sucesso", reqId: reqId(req),
      }));
      return res.status(204).end();
    }

    return erro(res, 405, "metodo_nao_permitido");
  } catch {
    return erro(res, 503, "token_indisponivel");
  }
}
