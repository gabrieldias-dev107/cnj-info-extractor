# Plano de implementação — P2: API interna, score e trilha de auditoria

## Como usar

Cada tarefa altera uma unidade coerente, indica os arquivos afetados e tem uma
forma objetiva de validação. Marque-a concluída somente após a verificação
correspondente.

## Fase 1 — Preparação

- [x] 1.1 Commitar o restyle pendente isolado, antes de tocar no P2 — Arquivos:
      `index.html`, `styles.css`, `tests/node/ui-security.test.js` — Validar:
      `npm test` verde e commit `style: adopt operational design tokens`.
- [x] 1.2 Escrever a especificação — Arquivos: `specs/p2-integracao/*` —
      Validar: `requirements.md`, `design.md` e `tasks.md` presentes.

## Fase 2 — Implementação

- [x] 2.1 Endurecer o dispatcher: `handler` só como string única, array vira
      `400 rota_ambigua` — Arquivos: `server/handlers/dispatch.js`,
      `tests/node/handler-dispatch.test.js` — Validar: teste novo cobrindo o
      array.
- [x] 2.2 Score de elegibilidade como módulo puro versionado — Arquivos:
      `server/p2-score.js`, `tests/node/p2-score.test.js` — Validar: faixa,
      fatores, `confianca: "baixa"` sem TPU curado e ressalva sempre presente.
- [x] 2.3 Migration `0004-p2-integracao.sql`: colunas de score, `service_tokens`,
      `audit_events` e índices — Arquivos: `db/migrations/0004-p2-integracao.sql`
      — Validar: só statements idempotentes, sem `ADD CONSTRAINT`, sem `DO $$`,
      sem `;` em comentário.
- [x] 2.4 Persistência: score no snapshot, funções de token e de auditoria,
      expurgo estendido — Arquivos: `server/db.js`, `tests/node/db.test.js` —
      Validar: colunas no `INSERT`/`SELECT`, autorização no SQL, ordem do
      expurgo e evento do próprio expurgo.
- [x] 2.5 Cota por token, fail-closed — Arquivos: `server/rate-limit.js`,
      `tests/node/ratelimit.test.js` — Validar: bloqueio por minuto e por dia,
      negativa com Redis indisponível.
- [x] 2.6 Rotas `/api/v1/decodificar` e `/api/v1/processos` — Arquivos:
      `server/handlers/api-v1.js`, `tests/node/p2-api.test.js` — Validar: 401
      sem token, 401 com token revogado e vencido, 429 na cota, cache hit,
      `Cache-Control: no-store`, cookie ignorado.
- [x] 2.7 Rotas de token e de trilha — Arquivos:
      `server/handlers/service-tokens.js`, `server/handlers/audit.js`,
      `tests/node/p2-tokens.test.js` — Validar: valor exibido uma única vez,
      isolamento por criador, trilha só do próprio usuário, Bearer recusado.
- [x] 2.8 Registrar as rotas na agregadora e no `vercel.json` — Arquivos:
      `api/p1-query-handler.js`, `vercel.json`,
      `tests/node/module-resolution.test.js` — Validar: rewrites presentes e
      `api/` com 11 arquivos.
- [x] 2.9 Fechar os pontos cegos da trilha, inclusive negativas — Arquivos:
      `server/handlers/datajud.js`, `server/handlers/process-history.js`,
      `server/handlers/portfolio-members.js`, `server/handlers/monitor-item.js`,
      `server/handlers/health-item.js`, `api/batches/export.js`,
      `api/batch-worker.js` e testes — Validar: cache hit, automação, histórico,
      exportação, membro concedido/removido e tentativas negadas gravam evento.
- [x] 2.10 Interface: faixa na consulta e no lote, exportações, painéis de token
      e de trilha — Arquivos: `js/p2-api.js`, `index.html`, `js/app.js`,
      `js/p1-ui.js`, `styles.css`, `server/batch-export.js`, `server/xlsx.js` e
      testes — Validar: sem `innerHTML` com dado remoto, ressalva e `confianca`
      visíveis, coluna nova no CSV e no XLSX.

## Fase 3 — Qualidade e entrega

- [x] 3.1 `npm test`, `npm run check`, `git diff --check`,
      `npm audit --omit=dev` — Validar: tudo verde, sem espaço em branco
      pendente, sem vulnerabilidade de produção.
- [x] 3.2 Documentação e política de retenção — Arquivos: `README.md`,
      `.env.example`, `docs/retencao.md` — Validar: rotas novas na lista que o
      teste de resolução verifica, `RL_API_TOKEN_DIA` e `RL_API_TOKEN_MIN` no
      `.env.example`, tabela de retenção por tipo de dado.
- [x] 3.3 Revisão `/codex:review` sobre o diff completo do P2 — Validar: achados
      tratados antes do commit final.
- [x] 3.4 Push da `feature/p1-consolidacao` e criação da `develop` — Validar:
      confirmação explícita do responsável, obtida antes do push.

## Desvios do plano original

- **`js/p2-ui.js` em vez de estender `js/p1-ui.js`.** O plano previa os painéis
  de token e de trilha dentro de `js/p1-ui.js`, que já tem ~900 linhas com
  glossário, carteiras, membros, sondas e histórico. O arquivo novo segue a
  convenção que o próprio repositório documenta: cada camada tem a própria tabela
  de mensagens e consulta a das outras quando não conhece o código
  (`MENSAGENS_P1` sobre `mensagemBase` de `js/app.js`). Com isso `js/p1-ui.js`
  não precisou de alteração alguma.
- **`server/audit.js` (não previsto).** Concentra a pseudonimização do ator e a
  gravação não fatal do evento. Sem ele, ou cada um dos sete pontos de chamada
  repetiria o mesmo `try/catch`, ou uma falha ao gravar a trilha derrubaria a
  requisição que a originou.
- **Colunas de exportação.** Além de `score_faixa`, o CSV e o XLSX levam
  `score_confianca`, `score_versao` e `score_ressalva`. A planilha circula fora da
  ferramenta, sem a tela que explica a faixa; a coluna sozinha é exatamente o que
  não pode viajar, e sem a confiança uma faixa apoiada em movimento TPU curado
  fica indistinguível de outra tirada só de sinais secundários (achado da
  revisão). Os `fatores` ficam de fora por serem uma lista por linha.
  `server/xlsx.js` passou a importar a lista de colunas de
  `server/batch-export.js`, para os dois formatos não divergirem, e
  `snapshots.score_confianca` virou coluna para alimentá-las.
- **Movimentos de todas as instâncias no score.** `scoreDaConsulta` classifica o
  estágio sobre os movimentos de todas as instâncias, como `persistSnapshot` já
  fazia. Olhando só a primeira, o fator `estagio_tpu` poderia dizer "nenhum
  movimento curado" ao lado de uma coluna `estagio` classificada.
- **Revisão.** `/codex:review` é command do plugin `openai-codex` e não aparece
  na lista de skills; foi executado pelo script companheiro do plugin, em
  background, sobre a working tree.

## Registro de validação

| Data | Tarefa | Comando/cenário | Resultado |
| --- | --- | --- | --- |
| 2026-09-08 | baseline | `npm test` / `npm run check` | 228/228; 50 arquivos, 0 erro |
| 2026-09-08 | 1.1 | `npm test` + commit isolado | 228/228; commit `7c7559c` |
| 2026-09-08 | 2.1–2.10 | `npm test` | 312/312 |
| 2026-09-08 | 2.3 | split por `;` simulado sobre `0004-p2-integracao.sql` | 12 statements, todos idempotentes; sem `ADD CONSTRAINT`, sem `DO $$`, sem `;` em comentário |
| 2026-09-08 | 3.1 | `npm test` / `npm run check` / `git diff --check` / `npm audit --omit=dev` | 312/312; 57 arquivos, 0 erro; sem apontamento; 0 vulnerabilidades |
| 2026-09-08 | 3.1 | contagem de Functions em `api/` | 11 de 12 |
| 2026-09-08 | 3.3 | `/codex:review` sobre a working tree | 5 achados P2, todos válidos e corrigidos; 1 teste de regressão por achado |
| 2026-09-08 | 3.3 | `npm test` após correções | 317/317 |
| 2026-09-08 | 3.4 | push de `develop` (44 commits) | Preview `dpl_3aqb8CCY97TJRDr54A7TaTmtVyTw` READY, 11 Functions |
| 2026-09-08 | 3.4 | push de `feature/p1-consolidacao` | nenhum deployment criado — `**: false` confirmado na prática |
| 2026-09-08 | 2.3 | `0003` contra banco vazio (Neon de Preview) | `NeonDbError` 42601 na posição 235 — `;` em comentário partia `CREATE TABLE health_probes`; corrigido e coberto por `tests/node/migrations.test.js` |
| 2026-09-08 | 2.3 | `node scripts/migrate.js` 2× no Neon de Preview | 4 migrations aplicadas nas duas execuções, `rc=0` — idempotência provada contra banco real |
| 2026-09-08 | 2.3 | `information_schema`/`pg_constraint` no Preview | 17 tabelas (8 P0 + 7 P1 + 2 P2); 4 colunas `snapshots.score*`; 3 FKs de `audit_events` com `confdeltype = n` (SET NULL); `consultation_events_created_at_idx` presente; CHECK de `actor_type` com os três valores |
