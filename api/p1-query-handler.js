import auditTrail from "../server/handlers/audit.js";
import datajud from "../server/handlers/datajud.js";
import healthProbes from "../server/handlers/health-probes.js";
import processHistory from "../server/handlers/process-history.js";
import serviceTokens from "../server/handlers/service-tokens.js";
import session from "../server/handlers/session.js";
import { decodificar, processos } from "../server/handlers/api-v1.js";
import { despachar } from "../server/handlers/dispatch.js";

// Rotas de sessão (cookie) e rotas de token de serviço convivem nesta Function.
// É por isso que `despachar` recusa `handler` ambíguo: sem essa trava, um
// chamador com token poderia dirigir a Function para uma rota de cookie.
export default despachar({
  session,
  datajud,
  "health-probes": healthProbes,
  "process-history": processHistory,
  "service-tokens": serviceTokens,
  audit: auditTrail,
  "v1-decodificar": decodificar,
  "v1-processos": processos,
});
