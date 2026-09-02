import assert from "node:assert/strict";
import test from "node:test";
import { despachar } from "../../server/handlers/dispatch.js";

test("dispatcher de worker restaura a URL pública assinada pelo QStash", async () => {
  let urlVista;
  const handler = despachar(
    { tick: async (req) => { urlVista = req.url; } },
    { urlsPublicas: { tick: "/api/monitor-worker" } },
  );
  const req = { query: { handler: "tick" }, url: "/api/p1-monitor-handler?handler=tick" };

  await handler(req, {});

  assert.equal(urlVista, "/api/monitor-worker");
  assert.equal(req.url, "/api/p1-monitor-handler?handler=tick");
});
