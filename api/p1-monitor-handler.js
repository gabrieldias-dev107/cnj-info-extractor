import item from "../server/handlers/monitor-item.js";
import tick from "../server/handlers/monitor-tick.js";
import { despachar } from "../server/handlers/dispatch.js";

export const config = { api: { bodyParser: false } };

export default despachar(
  { tick, item },
  {
    urlsPublicas: {
      tick: "/api/monitor-worker",
      item: "/api/monitor-item-worker",
    },
  },
);
