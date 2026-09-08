import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// `scripts/migrate.js` não tem ledger de versão: roda TODAS as migrations em
// TODA execução, dividindo cada arquivo por ";" e mandando os pedaços um a um.
// Esse split é ingênuo de propósito — enquanto o esquema tiver este tamanho, é
// barato. O preço é que algumas construções perfeitamente válidas em SQL
// quebram, e o defeito só aparece contra um banco vazio.
//
// Foi assim que `0003-p1-consolidacao.sql` chegou ao Preview com um ";" dentro
// de um comentário: o CREATE TABLE health_probes era partido ao meio e o
// Postgres respondia "syntax error at end of input". Num banco que já tinha as
// tabelas, ninguém percebia.
const DIRETORIO = "db/migrations";

function migrations() {
  return readdirSync(DIRETORIO).filter((nome) => nome.endsWith(".sql")).sort();
}

function conteudo(arquivo) {
  return readFileSync(join(DIRETORIO, arquivo), "utf8");
}

// Réplica exata do split de scripts/migrate.js:18.
function statements(texto) {
  return texto.split(";").map((item) => item.trim()).filter(Boolean);
}

function semComentarios(statement) {
  return statement.split("\n").filter((linha) => !linha.trim().startsWith("--")).join("\n").trim();
}

test("existe ao menos uma migration para validar", () => {
  assert.ok(migrations().length > 0, "nenhuma migration encontrada em " + DIRETORIO);
});

// A regressão que motivou este arquivo.
test("nenhum comentário contém ponto-e-vírgula", () => {
  for (const arquivo of migrations()) {
    conteudo(arquivo).split("\n").forEach((linha, indice) => {
      if (linha.trim().startsWith("--") && linha.includes(";")) {
        assert.fail(`${arquivo}:${indice + 1} tem ";" em comentário — o split parte o statement ao meio`);
      }
    });
  }
});

// Um statement partido pelo split quase sempre fica com parênteses abertos.
// É o sintoma mais barato de detectar sem um parser SQL.
test("todo statement fecha os parênteses que abre", () => {
  for (const arquivo of migrations()) {
    statements(conteudo(arquivo)).forEach((statement, indice) => {
      const sql = semComentarios(statement);
      const abre = (sql.match(/\(/g) || []).length;
      const fecha = (sql.match(/\)/g) || []).length;
      assert.equal(abre, fecha, `${arquivo} statement ${indice}: ${abre} "(" para ${fecha} ")" — provavelmente partido pelo split`);
    });
  }
});

// Um comentário solto depois do último ";" vira um "statement" só de comentário,
// que o Postgres recusa como consulta vazia.
test("nenhum statement é só comentário", () => {
  for (const arquivo of migrations()) {
    statements(conteudo(arquivo)).forEach((statement, indice) => {
      assert.notEqual(semComentarios(statement), "", `${arquivo} statement ${indice}: só comentário, sem SQL`);
    });
  }
});

// Rodar duas vezes seguidas precisa ser um no-op. `ADD CONSTRAINT` não aceita
// IF NOT EXISTS e falharia na segunda execução; `DO $$` contém ";" e seria
// picotado pelo split.
test("nada que quebre na segunda execução", () => {
  for (const arquivo of migrations()) {
    const texto = conteudo(arquivo);
    assert.equal(/ADD\s+CONSTRAINT/i.test(texto), false, `${arquivo}: ADD CONSTRAINT não tem IF NOT EXISTS`);
    assert.equal(/DO\s+\$\$/i.test(texto), false, `${arquivo}: bloco DO $$ não sobrevive ao split por ";"`);
  }
});

// CREATE precisa de IF NOT EXISTS. ALTER TABLE é aceito nas duas formas que o
// projeto usa: ADD COLUMN IF NOT EXISTS e ALTER COLUMN ... TYPE, que é no-op
// quando o tipo já bate (ver 0002-numero-varchar.sql).
test("todo statement é idempotente", () => {
  for (const arquivo of migrations()) {
    statements(conteudo(arquivo)).forEach((statement, indice) => {
      const sql = semComentarios(statement).replace(/\s+/g, " ");
      const onde = `${arquivo} statement ${indice}: ${sql.slice(0, 70)}`;

      if (/^CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX)/i.test(sql)) {
        assert.match(sql, /IF\s+NOT\s+EXISTS/i, onde + " — CREATE precisa de IF NOT EXISTS");
        return;
      }
      if (/^ALTER\s+TABLE/i.test(sql)) {
        const seguro = /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i.test(sql) || /ALTER\s+COLUMN\s+.+\s+TYPE\s+/i.test(sql);
        assert.ok(seguro, onde + " — ALTER TABLE só como ADD COLUMN IF NOT EXISTS ou ALTER COLUMN ... TYPE");
        return;
      }
      assert.fail(onde + " — comando não previsto; confirme que roda duas vezes sem erro");
    });
  }
});
