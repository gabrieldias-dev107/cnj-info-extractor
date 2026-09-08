// Leitura da trilha de auditoria do próprio usuário.
//
// Sem esta rota a trilha existiria só no banco, e "temos auditoria" seria uma
// afirmação não verificável por quem a usa. Cada usuário lê apenas os próprios
// eventos — o escopo vem do SQL, não de parâmetro.
//
// Rota de sessão: cadeia canônica `origemPermitida` → `ssoConfigurado` →
// `currentUser`, e `Authorization: Bearer` é recusado. Um token de serviço não
// lê a trilha de ninguém.
import { auditEventsForUser } from "../db.js";
import { auditar } from "../audit.js";
import { currentUser } from "../sso.js";
import { origemPermitida } from "../origin.js";
import { ssoConfigurado } from "../sso-config.js";

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;

function erro(res, status, codigo) {
  return res.status(status).json({ error: codigo });
}

function temBearer(req) {
  const cabecalho = (req.headers && req.headers.authorization) || "";
  return /^Bearer\s+\S+/i.test(String(Array.isArray(cabecalho) ? cabecalho[0] : cabecalho));
}

function reqIdDe(req) {
  const valor = req.headers && req.headers["x-vercel-id"];
  return typeof valor === "string" ? valor : null;
}

// Ausente e ilegível caem no padrão; fora da faixa é aparado. `Number("")` é 0,
// então a string vazia precisa sair antes da conversão.
function inteiro(valor, padrao, minimo, maximo) {
  const texto = String(valor == null ? "" : valor).trim();
  if (!texto) return padrao;
  const numero = Number(texto);
  if (!Number.isInteger(numero)) return padrao;
  return Math.min(maximo, Math.max(minimo, numero));
}

// `process_id` sai; o número CNJ não — a trilha nunca o guardou. Quem precisa do
// número parte do processo pelas rotas que já exigem vínculo.
function eventoPublico(evento) {
  return {
    id: evento.id,
    ator: evento.ator_rotulo || evento.actor_type,
    atorTipo: evento.actor_type,
    acao: evento.acao,
    recurso: evento.recurso || null,
    resultado: evento.resultado,
    processId: evento.process_id || null,
    serviceTokenId: evento.service_token_id || null,
    reqId: evento.req_id || null,
    createdAt: evento.created_at,
  };
}

export default async function handler(req, res) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");

  // Tentar ler a trilha de outra origem, sem sessão ou com token de serviço é
  // exatamente o tipo de acesso que a trilha precisa registrar. Ator anônimo,
  // porque a identidade ainda não foi estabelecida.
  const auditarRecusa = (resultado) => (ssoConfigurado()
    ? auditar({ actorType: "usuario", userId: null, atorRotulo: "anonimo", acao: "trilha_auditoria", recurso: null, resultado, reqId: reqIdDe(req) })
    : Promise.resolve());

  if (!origemPermitida(req)) {
    await auditarRecusa("negado_origem");
    return erro(res, 403, "origem_nao_permitida");
  }
  if (!ssoConfigurado()) return erro(res, 503, "autenticacao_indisponivel");
  if (temBearer(req)) {
    await auditarRecusa("negado_bearer_em_rota_de_sessao");
    return res.status(401).json({ error: "autenticacao_necessaria", login: "sso" });
  }

  const user = await currentUser(req);
  if (!user) {
    await auditarRecusa("negado_sem_sessao");
    return res.status(401).json({ error: "autenticacao_necessaria", login: "sso" });
  }
  if (req.method !== "GET") return erro(res, 405, "metodo_nao_permitido");

  const query = req.query || {};
  const limite = inteiro(query.limite, LIMITE_PADRAO, 1, LIMITE_MAXIMO);
  const offset = inteiro(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  try {
    const trilha = await auditEventsForUser(user.id, { limite, offset });
    return res.status(200).json({
      eventos: trilha.eventos.map(eventoPublico),
      total: trilha.total,
      limite,
      offset,
    });
  } catch {
    return erro(res, 503, "auditoria_indisponivel");
  }
}
