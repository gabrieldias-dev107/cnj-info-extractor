import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// O bug que motivou este teste: três handlers importavam "../../../server/*",
// um nível acima da raiz. `node --check` só analisa sintaxe, nenhum teste os
// importava, e o CI ficou verde enquanto login, callback e expurgo quebravam
// em produção com ERR_MODULE_NOT_FOUND.
function arquivos(diretorio) {
  const encontrados = [];
  for (const entrada of readdirSync(diretorio)) {
    const caminho = join(diretorio, entrada);
    if (statSync(caminho).isDirectory()) encontrados.push(...arquivos(caminho));
    else if (caminho.endsWith(".js")) encontrados.push(caminho);
  }
  return encontrados;
}

test("todo módulo de api/ e server/ resolve seus imports", async () => {
  const alvos = [...arquivos("api"), ...arquivos("server")];
  assert.ok(alvos.length > 15, "esperava encontrar os módulos do servidor");

  const falhas = [];
  for (const caminho of alvos) {
    try {
      await import(pathToFileURL(caminho).href);
    } catch (error) {
      falhas.push(caminho + " -> " + (error.code || error.name));
    }
  }
  assert.deepEqual(falhas, []);
});

test("documentação operacional lista rotas P1 e variáveis do Resend", () => {
  const readme = readFileSync("README.md", "utf8");
  const env = readFileSync(".env.example", "utf8");
  const rotas = [
    "/api/portfolios",
    "/api/portfolios/items",
    "/api/portfolios/members",
    "/api/health-probes",
    "/api/process-history",
    "/api/monitor-worker",
    "/api/monitor-item-worker",
    "/api/health-worker",
    "/api/health-item-worker",
    "/api/digest-worker",
  ];

  for (const rota of rotas) assert.ok(readme.includes(rota), "README sem " + rota);
  assert.match(env, /^RESEND_API_KEY=$/m);
  assert.match(env, /^RESEND_FROM_EMAIL=$/m);
});

test("Vercel mantém as rotas P1 em no máximo 12 Functions", () => {
  const funcoes = arquivos("api");
  assert.ok(funcoes.length <= 12, `Vercel Hobby aceita no máximo 12 Functions; encontrou ${funcoes.length}`);

  const { rewrites = [] } = JSON.parse(readFileSync("vercel.json", "utf8"));
  const rotasConsolidadas = {
    "/api/auth/login": "/api/p1-auth-handler?handler=login",
    "/api/auth/callback": "/api/p1-auth-handler?handler=callback",
    "/api/portfolios": "/api/p1-portfolio-handler?handler=portfolio",
    "/api/portfolios/items": "/api/p1-portfolio-handler?handler=items",
    "/api/portfolios/members": "/api/p1-portfolio-handler?handler=members",
    "/api/session": "/api/p1-query-handler?handler=session",
    "/api/datajud": "/api/p1-query-handler?handler=datajud",
    "/api/health-probes": "/api/p1-query-handler?handler=health-probes",
    "/api/process-history": "/api/p1-query-handler?handler=process-history",
    "/api/monitor-worker": "/api/p1-monitor-handler?handler=tick",
    "/api/monitor-item-worker": "/api/p1-monitor-handler?handler=item",
    "/api/health-worker": "/api/p1-health-handler?handler=tick",
    "/api/health-item-worker": "/api/p1-health-handler?handler=item",
  };

  for (const [source, destination] of Object.entries(rotasConsolidadas)) {
    assert.ok(
      rewrites.some((rewrite) => rewrite.source === source && rewrite.destination === destination),
      `rewrite ausente: ${source} -> ${destination}`,
    );
  }
});
