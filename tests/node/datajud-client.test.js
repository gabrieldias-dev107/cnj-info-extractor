import assert from "node:assert/strict";
import test from "node:test";

process.env.DATAJUD_API_KEY = "chave-de-teste";

const { consultarDatajud } = await import("../../server/datajud-client.js");

test("cliente DataJud normaliza e ordena instâncias para o worker", async () => {
  const resposta = await consultarDatajud("00013278820188260344", "api_publica_tjsp", async () => ({
    ok: true,
    async json() {
      return { hits: { hits: [
        { _source: { numeroProcesso: "00013278820188260344", grau: "G2", movimentos: [{ codigo: 12548, nome: "Alvará", dataHora: "2026-08-02T10:00:00Z" }] } },
        { _source: { numeroProcesso: "00013278820188260344", grau: "G1", movimentos: [] } },
      ] } };
    },
  }));

  assert.equal(resposta.encontrado, true);
  assert.deepEqual(resposta.processos.map((processo) => processo.grau), ["G1", "G2"]);
  assert.equal(resposta.processos[1].movimentos[0].codigo, 12548);
});
