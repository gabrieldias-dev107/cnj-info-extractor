import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL ausente");
const sql = neon(url);
const migration = await readFile(new URL("../db/migrations/0001-p0.sql", import.meta.url), "utf8");
for (const statement of migration.split(";").map((item) => item.trim()).filter(Boolean)) await sql.query(statement);
console.log("Migração P0 aplicada.");
