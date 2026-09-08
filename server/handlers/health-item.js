import { healthProbeForWorker, recordHealthMeasurement } from "../db.js";
import { auditar, atorAutomacao } from "../audit.js";
import { circuitoAberto, classificarFalhaTribunal, consultarComResiliencia } from "../p1-automation.js";
import { verifyQstash } from "../queue.js";
import { consumirSaude } from "../rate-limit.js";

export const config = { api: { bodyParser: false } };

async function lerBody(req) {
  const partes = [];
  for await (const parte of req) partes.push(parte);
  return Buffer.concat(partes).toString("utf8");
}

function codigo(error) {
  return String((error && (error.codigo || error.message)) || "erro_interno");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "metodo_nao_permitido" });
  let probeId = null;
  try {
    const raw = await lerBody(req);
    if (!await verifyQstash(req, raw)) return res.status(401).json({ error: "assinatura_invalida" });
    const body = JSON.parse(raw);
    if (!body || typeof body.healthProbeId !== "string") return res.status(400).json({ error: "probe_invalido" });

    probeId = body.healthProbeId;
    const probe = await healthProbeForWorker(probeId);
    if (!probe) return res.status(204).end();

    // O circuito aberto é estado observável do tribunal: vira medição própria,
    // sem gastar orçamento nem bater no DataJud.
    if (await circuitoAberto(probe.alias)) {
      await recordHealthMeasurement({ healthProbeId: probe.id, status: "circuito_aberto", statusCode: null, duracaoMs: null });
      return res.status(204).end();
    }

    const inicio = Date.now();
    // A sonda consulta um processo real no DataJud; é consulta de automação como
    // a de monitoramento, e entra na trilha pelo mesmo motivo. O recurso é o
    // alias do tribunal — o número da sonda não sai daqui.
    const auditarSonda = (resultado) => auditar(Object.assign({}, atorAutomacao("saude"), {
      acao: "consulta_automacao", recurso: probe.alias, resultado,
    }));
    try {
      await consultarComResiliencia(probe.numero, probe.alias, { consumirOrcamento: () => consumirSaude() });
      await recordHealthMeasurement({ healthProbeId: probe.id, status: "disponivel", statusCode: 200, duracaoMs: Date.now() - inicio });
      await auditarSonda("sucesso");
    } catch (error) {
      const erro = codigo(error);
      // Orçamento esgotado é limite nosso, não indisponibilidade do tribunal:
      // não vira medição para não sujar o histórico de saúde.
      if (erro === "orcamento_excedido") {
        await auditarSonda("negado_orcamento_excedido");
        return res.status(429).json({ error: erro });
      }
      const classificacao = classificarFalhaTribunal(erro);
      await recordHealthMeasurement({ healthProbeId: probe.id, status: classificacao.status, statusCode: classificacao.statusCode, duracaoMs: Date.now() - inicio });
      await auditarSonda("falha_" + erro);
    }
    return res.status(204).end();
  } catch (error) {
    const erro = codigo(error);
    console.error(JSON.stringify({ evento: "saude_falhou", healthProbeId: probeId, erro }));
    return res.status(500).json({ error: erro });
  }
}
