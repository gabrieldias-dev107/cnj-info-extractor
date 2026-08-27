import assert from "node:assert/strict";
import test from "node:test";
import { lerPlanilhaCsv } from "../../server/csv.js";
import { numerosDaPlanilha } from "../../server/batch-service.js";

test("detecta ponto e vírgula como delimitador pelo cabeçalho", () => {
  assert.deepEqual(lerPlanilhaCsv("numero;obs\n123;a\n"), [["numero", "obs"], ["123", "a"]]);
});

test("aspas protegem o delimitador e escapam aspas internas", () => {
  assert.deepEqual(lerPlanilhaCsv('numero,obs\n123,"a,b"\n456,"diz ""oi"""\n'), [
    ["numero", "obs"],
    ["123", "a,b"],
    ["456", 'diz "oi"'],
  ]);
});

test("aceita CRLF e BOM sem sujar o primeiro campo", () => {
  const comBom = "﻿numero\r\n123\r\n";
  assert.deepEqual(lerPlanilhaCsv(comBom), [["numero"], ["123"]]);
  assert.deepEqual(numerosDaPlanilha(lerPlanilhaCsv(comBom)), ["123"]);
});

test("linhas em branco não viram itens do lote", () => {
  assert.deepEqual(lerPlanilhaCsv("123\n\n\n456\n"), [["123"], ["456"]]);
});

test("última linha sem quebra ainda é lida", () => {
  assert.deepEqual(lerPlanilhaCsv("123\n456"), [["123"], ["456"]]);
});

test("aspas não fechadas são rejeitadas em vez de engolir o resto", () => {
  assert.throws(() => lerPlanilhaCsv('numero\n"123\n'), /csv_invalido/);
});

test("arquivo vazio ou só com espaços é rejeitado", () => {
  assert.throws(() => lerPlanilhaCsv("   \n \n"), /csv_invalido/);
  assert.throws(() => lerPlanilhaCsv(""), /csv_invalido/);
});

test("acima de 2 MiB é recusado antes de decodificar", () => {
  assert.throws(() => lerPlanilhaCsv(Buffer.alloc(2 * 1024 * 1024 + 1, 0x31)), /arquivo_maior_que_2mb/);
});

test("cabeçalho numero escolhe a coluna certa, não a primeira", () => {
  const linhas = lerPlanilhaCsv("cliente,numero\nACME,00013278820188260344\n");
  assert.deepEqual(numerosDaPlanilha(linhas), ["00013278820188260344"]);
});
