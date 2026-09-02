import item from "../server/handlers/health-item.js";
import tick from "../server/handlers/health-tick.js";
import { despachar } from "../server/handlers/dispatch.js";

export const config = { api: { bodyParser: false } };

export default despachar(
  { tick, item },
  {
    urlsPublicas: {
      tick: "/api/health-worker",
      item: "/api/health-item-worker",
    },
  },
);
