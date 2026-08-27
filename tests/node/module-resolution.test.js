import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, statSync } from "node:fs";
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
