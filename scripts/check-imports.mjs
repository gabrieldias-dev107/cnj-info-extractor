// Verifica que todo módulo do servidor resolve seus imports de verdade.
// `node --check` só analisa sintaxe: um especificador errado passa batido e
// só falha em produção. Aqui cada arquivo é importado de fato.
import { readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DIRETORIOS_ESM = ["api", "server", "scripts"];
const DIRETORIOS_CLASSICOS = ["js"];
const IGNORADOS = new Set(["scripts/check-imports.mjs", "scripts/migrate.js"]);

function arquivos(diretorio) {
  const encontrados = [];
  for (const entrada of readdirSync(diretorio)) {
    const caminho = join(diretorio, entrada);
    if (statSync(caminho).isDirectory()) encontrados.push(...arquivos(caminho));
    else if (/\.m?js$/.test(entrada)) encontrados.push(caminho);
  }
  return encontrados;
}

const falhas = [];
let verificados = 0;

for (const diretorio of DIRETORIOS_ESM) {
  for (const caminho of arquivos(diretorio)) {
    if (IGNORADOS.has(caminho.split("\\").join("/"))) continue;
    verificados += 1;
    try {
      await import(pathToFileURL(caminho).href);
    } catch (error) {
      falhas.push(caminho + " -> " + (error.code || error.name) + ": " + error.message.split("\n")[0]);
    }
  }
}

// Scripts clássicos (IIFE, sem `export`) não são importáveis como ESM;
// para eles a checagem de sintaxe continua sendo o que dá para fazer.
for (const diretorio of DIRETORIOS_CLASSICOS) {
  for (const caminho of arquivos(diretorio)) {
    verificados += 1;
    try {
      execFileSync(process.execPath, ["--check", caminho], { stdio: "pipe" });
    } catch (error) {
      falhas.push(caminho + " -> sintaxe: " + String(error.stderr || error.message).split("\n")[0]);
    }
  }
}

// `scripts/migrate.js` conecta ao Neon no topo do módulo; importá-lo aqui
// tentaria abrir conexão, então fica só na checagem de sintaxe.
for (const caminho of ["scripts/migrate.js"]) {
  verificados += 1;
  try {
    execFileSync(process.execPath, ["--check", caminho], { stdio: "pipe" });
  } catch (error) {
    falhas.push(caminho + " -> sintaxe: " + String(error.stderr || error.message).split("\n")[0]);
  }
}

for (const falha of falhas) console.error(falha);
console.log((falhas.length ? "FALHOU" : "OK") + ": " + verificados + " arquivos verificados, " + falhas.length + " com erro.");
if (falhas.length) process.exit(1);
