// Fachada da trilha de auditoria.
//
// Duas responsabilidades, ambas de fronteira:
//   1. pseudonimizar o rótulo do ator, para que a trilha nunca guarde e-mail;
//   2. impedir que uma falha ao gravar o evento derrube a requisição que o
//      originou — a consulta do usuário não pode virar 500 porque a auditoria
//      caiu. A falha vira uma linha de log estruturada, e não silêncio.
import { createHmac } from "node:crypto";
import { recordAuditEvent } from "./db.js";

function segredo() {
  return String(process.env.SESSION_SECRET || "auditoria-sem-segredo");
}

// Mesmo HMAC usado para pseudonimizar IP no rate limit: identificador estável
// para correlacionar eventos do mesmo ator, sem carregar dado pessoal.
export function rotuloAtor(actorType, identificador) {
  if (!identificador) return actorType;
  const digest = createHmac("sha256", segredo()).update(actorType + ":" + identificador, "utf8").digest("hex");
  return actorType.slice(0, 1) + "_" + digest.slice(0, 12);
}

export function atorUsuario(user) {
  return { actorType: "usuario", userId: user && user.id ? user.id : null, atorRotulo: rotuloAtor("usuario", user && user.id) };
}

// O prefixo do token já é público e não secreto; usá-lo como rótulo deixa a
// trilha legível para quem administra a credencial.
export function atorToken(token) {
  return {
    actorType: "token",
    userId: token && token.creatorUserId ? token.creatorUserId : null,
    serviceTokenId: token && token.id ? token.id : null,
    atorRotulo: token && token.prefixo ? "t_" + token.prefixo : "token",
  };
}

export function atorAutomacao(nome) {
  return { actorType: "automacao", atorRotulo: String(nome || "automacao") };
}

export async function auditar(evento) {
  try {
    await recordAuditEvent(evento);
  } catch (error) {
    // Sem número de processo, sem e-mail: só a ação e o motivo da falha.
    console.error(JSON.stringify({
      evento: "auditoria_falhou",
      acao: evento && evento.acao,
      resultado: evento && evento.resultado,
      erro: (error && error.message) || String(error),
    }));
  }
}
