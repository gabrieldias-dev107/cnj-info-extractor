import { readdir, readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL ausente");
const sql = neon(url);

// Sem ledger de versão: toda migração precisa ser idempotente, porque todas
// rodam em toda execução. `IF NOT EXISTS` nos CREATE e ALTER ... TYPE (que é
// no-op quando o tipo já bate) dão conta enquanto o esquema for este tamanho.
// Limitação conhecida: o split por ";" quebra em função ou bloco DO.
const diretorio = new URL("../db/migrations/", import.meta.url);
const arquivos = (await readdir(diretorio)).filter((nome) => nome.endsWith(".sql")).sort();
if (!arquivos.length) throw new Error("nenhuma migração encontrada");

for (const arquivo of arquivos) {
  const conteudo = await readFile(new URL(arquivo, diretorio), "utf8");
  for (const statement of conteudo.split(";").map((item) => item.trim()).filter(Boolean)) await sql.query(statement);
  console.log("Aplicada: " + arquivo);
}
console.log("Migrações aplicadas: " + arquivos.length + ".");
