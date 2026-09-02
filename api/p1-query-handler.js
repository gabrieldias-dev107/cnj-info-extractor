import datajud from "../server/handlers/datajud.js";
import healthProbes from "../server/handlers/health-probes.js";
import processHistory from "../server/handlers/process-history.js";
import session from "../server/handlers/session.js";
import { despachar } from "../server/handlers/dispatch.js";

export default despachar({
  session,
  datajud,
  "health-probes": healthProbes,
  "process-history": processHistory,
});
