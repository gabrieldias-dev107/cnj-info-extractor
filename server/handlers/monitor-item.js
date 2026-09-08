import { createPendingAlerts, latestSnapshotForProcess, monitoredProcessForWorker, persistSnapshot, updateMonitoredProcessStage } from "../db.js";
import { auditar, atorAutomacao } from "../audit.js";
import { consultarComResiliencia } from "../p1-automation.js";
import { mudancaRelevante } from "../p1-core.js";
import { verifyQstash } from "../queue.js";
import { consumirMonitoramento } from "../rate-limit.js";

export const config = { api: { bodyParser: false } };

// Erros que não melhoram com repetição: devolver 204 evita que o QStash fique
// reenfileirando um item que só volta com mudança de configuração.
const TERMINAIS = new Set(["alias_inexistente", "config_ausente"]);

async function lerBody(req) {
  const partes = [];
  for await (const parte of req) partes.push(parte);
  return Buffer.concat(partes).toString("utf8");
}

function codigo(error) {
  return String((error && (error.codigo || error.message)) || "erro_interno");
}

function statusDoErro(erro) {
  if (TERMINAIS.has(erro)) return 204;
  if (erro === "orcamento_excedido") return 429;
  if (erro === "circuito_aberto") return 503;
  return 500;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "metodo_nao_permitido" });
  let monitoradoId = null;
  try {
    const raw = await lerBody(req);
    if (!await verifyQstash(req, raw)) return res.status(401).json({ error: "assinatura_invalida" });
    const body = JSON.parse(raw);
    if (!body || typeof body.monitoredProcessId !== "string") return res.status(400).json({ error: "item_invalido" });

    monitoradoId = body.monitoredProcessId;
    const monitorado = await monitoredProcessForWorker(monitoradoId);
    if (!monitorado) return res.status(204).end();

    // `anterior` serve só para amarrar o alerta ao snapshot que veio antes.
    // A comparação NÃO pode usá-lo: `processes`/`snapshots` são globais por
    // número, então uma consulta manual ou o tick de outro portfólio já teria
    // consumido a transição e este item nunca alertaria.
    const anterior = await latestSnapshotForProcess(monitorado.process_id);
    const conhecido = { estagio: monitorado.estagio_conhecido };
    const resposta = await consultarComResiliencia(monitorado.numero, monitorado.alias, { consumirOrcamento: () => consumirMonitoramento() });
    const salvo = await persistSnapshot({ numero: monitorado.numero, alias: monitorado.alias, dados: resposta });

    // A relevância vem só do catálogo TPU versionado; nome de movimento nunca
    // decide alerta.
    if (mudancaRelevante(conhecido, salvo.estagio)) {
      await createPendingAlerts({
        monitoredProcessId: monitorado.id,
        snapshotAnteriorId: anterior ? anterior.id : null,
        snapshotAtualId: salvo.snapshotId,
        estagioAnterior: monitorado.estagio_conhecido || null,
        estagioAtual: salvo.estagio.estagio,
      });
    }
    // Gravado sempre, com ou sem alerta: é o que este item passa a conhecer.
    await updateMonitoredProcessStage(monitorado.id, { estagio: salvo.estagio.estagio, codigo: salvo.estagio.codigo });
    // A automação também consulta dado processual. Sem este registro, a maior
    // fonte de consultas do sistema ficava fora da trilha.
    await auditar(Object.assign({}, atorAutomacao("monitoramento"), {
      acao: "consulta_automacao", recurso: "monitored_process", resultado: "sucesso", processId: monitorado.process_id,
    }));
    return res.status(204).end();
  } catch (error) {
    const erro = codigo(error);
    const status = statusDoErro(erro);
    // Só identificadores no log: o número CNJ não sai daqui.
    console.error(JSON.stringify({ evento: "monitoramento_falhou", monitoredProcessId: monitoradoId, erro }));
    await auditar(Object.assign({}, atorAutomacao("monitoramento"), {
      acao: "consulta_automacao", recurso: "monitored_process", resultado: "falha_" + erro,
    }));
    return status === 204 ? res.status(204).end() : res.status(status).json({ error: erro });
  }
}
