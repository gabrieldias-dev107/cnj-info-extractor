import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { response } from "./helpers/http.js";

const estado = {
  usuario: { id: "user-1", email: "membro@btblue.com.br" },
  ssoLigado: true,
  historico: [
    { id: "snap-2", consultado_em: "2026-09-01T10:00:00.000Z", estagio: "expedicao_alvara", estagio_codigo: 12548, estagio_data: "2026-09-01T09:00:00.000Z", tpu_versao: "tpu-2026-04-09-semente-1", dados: { numero: "não deve sair" } },
    { id: "snap-1", consultado_em: "2026-08-31T10:00:00.000Z", estagio: "nao_classificado", estagio_codigo: null, estagio_data: null, tpu_versao: "tpu-2026-04-09-semente-1" },
  ],
};
const chamadas = [];

mock.module("../../server/sso.js", { namedExports: { currentUser: async () => estado.usuario } });
mock.module("../../server/sso-config.js", { namedExports: { ssoConfigurado: () => estado.ssoLigado } });
mock.module("../../server/db.js", {
  namedExports: {
    processHistoryForUser: async (...args) => { chamadas.push(args); return estado.historico; },
  },
});

const headers = { host: "app.vercel.app", origin: "https://app.vercel.app" };
const NUMERO = "00013278820188260344";

async function handler() {
  const modulo = await import("../../api/process-history.js").catch(() => ({}));
  assert.equal(typeof modulo.default, "function", "api/process-history.js precisa expor um handler");
  return modulo.default;
}

function reiniciar() {
  estado.usuario = { id: "user-1", email: "membro@btblue.com.br" };
  estado.ssoLigado = true;
  estado.historico = [
    { id: "snap-2", consultado_em: "2026-09-01T10:00:00.000Z", estagio: "expedicao_alvara", estagio_codigo: 12548, estagio_data: "2026-09-01T09:00:00.000Z", tpu_versao: "tpu-2026-04-09-semente-1", dados: { numero: "não deve sair" } },
    { id: "snap-1", consultado_em: "2026-08-31T10:00:00.000Z", estagio: "nao_classificado", estagio_codigo: null, estagio_data: null, tpu_versao: "tpu-2026-04-09-semente-1" },
  ];
  chamadas.length = 0;
}

test("histórico devolve snapshots reduzidos e delta TPU para membro do portfólio", async () => {
  reiniciar();
  const historico = await handler();
  const res = response();

  await historico({ method: "GET", headers, query: { numero: NUMERO } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    snapshots: [
      { id: "snap-2", consultadoEm: "2026-09-01T10:00:00.000Z", estagio: "expedicao_alvara", codigo: 12548, data: "2026-09-01T09:00:00.000Z", versao: "tpu-2026-04-09-semente-1" },
      { id: "snap-1", consultadoEm: "2026-08-31T10:00:00.000Z", estagio: "nao_classificado", codigo: null, data: null, versao: "tpu-2026-04-09-semente-1" },
    ],
    delta: { anterior: "nao_classificado", atual: "expedicao_alvara", relevante: true },
  });
  assert.deepEqual(chamadas, [[NUMERO, "user-1"]]);
  assert.equal(JSON.stringify(res.body).includes("não deve sair"), false, "payload bruto do DataJud não pertence ao contrato de histórico");
});

test("histórico de processo fora do portfólio é um 404 indistinguível", async () => {
  reiniciar();
  estado.historico = null;
  const historico = await handler();
  const res = response();

  await historico({ method: "GET", headers, query: { numero: NUMERO } }, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "processo_nao_encontrado" });
});

test("histórico exige número CNJ com 20 dígitos, mesma origem e sessão", async () => {
  reiniciar();
  const historico = await handler();

  const invalido = response();
  await historico({ method: "GET", headers, query: { numero: "123" } }, invalido);
  assert.equal(invalido.statusCode, 400);
  assert.deepEqual(invalido.body, { error: "numero_invalido" });

  const origemCruzada = response();
  await historico({ method: "GET", headers: { host: "app.vercel.app", origin: "https://outro.example" }, query: { numero: NUMERO } }, origemCruzada);
  assert.equal(origemCruzada.statusCode, 403);

  estado.usuario = null;
  const semSessao = response();
  await historico({ method: "GET", headers, query: { numero: NUMERO } }, semSessao);
  assert.equal(semSessao.statusCode, 401);
  assert.deepEqual(semSessao.body, { error: "autenticacao_necessaria", login: "sso" });
});
