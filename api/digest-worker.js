import { recordAlertSendAttempt, undeliveredAlerts } from "../server/db.js";
import { montarEmailDigest } from "../server/p1-automation.js";
import { verifyQstash } from "../server/queue.js";
import { enviarEmail } from "../server/resend.js";

export const config = { api: { bodyParser: false } };

async function lerBody(req) {
  const partes = [];
  for await (const parte of req) partes.push(parte);
  return Buffer.concat(partes).toString("utf8");
}

function codigo(error) {
  return String((error && (error.codigo || error.message)) || "erro_interno");
}

function agruparPorDestinatario(alertas) {
  const grupos = new Map();
  for (const alerta of alertas) {
    const chave = String(alerta.recipient_user_id);
    if (!grupos.has(chave)) grupos.set(chave, { email: alerta.email, alertas: [] });
    grupos.get(chave).alertas.push(alerta);
  }
  return grupos;
}

// Tick único, agendado externamente para 08:00 BRT. Não há fan-out por item: o
// digest existe justamente para juntar as movimentações do dia num e-mail por
// destinatário.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "metodo_nao_permitido" });
  try {
    const raw = await lerBody(req);
    if (!await verifyQstash(req, raw)) return res.status(401).json({ error: "assinatura_invalida" });

    const pendentes = await undeliveredAlerts();
    if (!pendentes.length) return res.status(204).end();

    const grupos = agruparPorDestinatario(pendentes);
    let enviados = 0;
    let falhas = 0;
    for (const grupo of grupos.values()) {
      const mensagem = montarEmailDigest(grupo.alertas);
      try {
        await enviarEmail({ para: grupo.email, assunto: mensagem.assunto, html: mensagem.html, texto: mensagem.texto });
        // Só depois do aceite do Resend o alerta vira entregue; a recusa de um
        // destinatário não contamina os demais.
        for (const alerta of grupo.alertas) await recordAlertSendAttempt(alerta.id, { status: "enviado", erro: null });
        enviados += grupo.alertas.length;
      } catch (error) {
        const erro = codigo(error);
        for (const alerta of grupo.alertas) await recordAlertSendAttempt(alerta.id, { status: "falhou", erro });
        falhas += 1;
        // Nem e-mail, nem número CNJ, nem chave: só o identificador do alerta.
        console.error(JSON.stringify({ evento: "digest_falhou", alertas: grupo.alertas.map((alerta) => alerta.id), erro }));
      }
    }
    const resumo = { destinatarios: grupos.size, enviados, falhas };
    if (falhas) return res.status(500).json({ error: "digest_parcial", ...resumo });
    return res.status(200).json(resumo);
  } catch (error) {
    return res.status(503).json({ error: codigo(error) });
  }
}
