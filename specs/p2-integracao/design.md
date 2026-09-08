# Design técnico — P2: API interna, score de elegibilidade e trilha de auditoria

## Resumo da solução

Três entregas independentes que compartilham a mesma infraestrutura já montada
no P1: handlers em `server/handlers/` registrados na Function agregadora,
autorização dentro do SQL, expiração por `expires_at` e expurgo assinado.

1. **API interna.** Duas rotas `/api/v1/*` autenticadas somente por token de
   serviço, com cota própria. O token é gerado, listado e revogado pelo próprio
   criador via sessão SSO, no mesmo modelo das carteiras.
2. **Score.** Módulo puro versionado que transforma o snapshot normalizado numa
   faixa de prioridade com fatores explicáveis. A faixa é persistida no snapshot,
   como `estagio` já é.
3. **Trilha.** Tabela `audit_events` gravada nos pontos que hoje não deixam
   rastro, lida pelo próprio usuário e expurgada por retenção declarada.

## Arquitetura e fluxo

### Nenhuma Function nova

`tests/node/module-resolution.test.js:57` falha acima de 12 arquivos em `api/`;
hoje são 11. As quatro rotas novas entram como handlers registrados no agregador
`api/p1-query-handler.js` via `despachar` (`server/handlers/dispatch.js:6`), com
um rewrite por rota em `vercel.json` (não há wildcard em `rewrites`, e caminhos
com segmento variável como `/api/v1/processos/<numero>` não resolveriam — por
isso o número vai no corpo).

O caminho público é o contrato. A URL da agregadora
(`/api/p1-query-handler?handler=...`) continua endereçável e **não** é contrato.

### Endurecimento do dispatcher

A Vercel mescla a query do rewrite com a do cliente, por isso `dispatch.js:1` já
trata `handler` como possível array. Hoje é inofensivo — todas as rotas da
agregadora usam cookie e o mesmo usuário. Com rotas por token no mesmo arquivo,
um chamador poderia dirigir a Function para outro handler via `?handler=`.

Correção: aceitar somente valor string único; array vira `400 rota_ambigua`.
Reforço: as rotas `/api/v1/*` não leem nada da query (entrada só no corpo) e
cada handler valida explicitamente o mecanismo de autenticação que aceita.

### Fluxo de `POST /api/v1/processos`

```text
Bearer -> serviceTokenByHash -> consumirTokenServico (fail-closed)
       -> validarNumeroParaConsulta (alias derivado no servidor)
       -> freshSnapshot ? cache : (consumirDatajud sintético -> DataJud -> persistSnapshot)
       -> calcularScore -> resposta reduzida + audit_event
```

O débito nos contadores globais usa `req` sintético
(`x-forwarded-for: "api:<tokenId>"`), precedente em `api/batch-worker.js:39`.

### Isolamento de autenticação

| Rota | Aceita | Recusa |
|---|---|---|
| `/api/v1/*` | `Authorization: Bearer` | cookie de sessão |
| `/api/service-tokens`, `/api/audit` | sessão SSO | Bearer |

`/api/v1/*` não chama `origemPermitida` (`server/origin.js:7`): chamador
servidor-a-servidor não manda `Origin` nem `sec-fetch-site: same-origin`. Como
essas rotas não leem cookie, não há superfície de CSRF. As rotas de sessão
mantêm a cadeia canônica `origemPermitida` → `ssoConfigurado` → `currentUser`.

## Contratos e dados

### Entradas e saídas

| Rota | Entrada | Saída |
|---|---|---|
| `POST /api/v1/decodificar` | `{ numero }` | `{ numero, formatado, valido, sequencial, digitoVerificador, ano, segmento, tribunal, origem, alias }` |
| `POST /api/v1/processos` | `{ numero }` | `{ encontrado, total, cache, processos[], estagio, score }` |
| `GET /api/service-tokens` | — | `{ tokens: [{ id, nome, prefixo, limiteDia, criadoEm, ultimoUsoEm, revogadoEm, expiresAt }] }` |
| `POST /api/service-tokens` | `{ nome, limiteDia? }` | `{ id, nome, prefixo, token, limiteDia, expiresAt }` — `token` só aqui |
| `DELETE /api/service-tokens?id=<uuid>` | — | `204` |
| `GET /api/audit?limite=&offset=` | — | `{ eventos: [...], total }` |

Códigos de erro novos: `token_ausente`, `token_invalido`, `rota_ambigua`,
`token_nao_encontrado`, `nome_invalido`, `auditoria_indisponivel`,
`api_indisponivel`. Os herdados (`numero_invalido`, `limite_excedido`,
`metodo_nao_permitido`, `autenticacao_necessaria`) mantêm o significado.

### Score

`server/p2-score.js`, módulo puro, sem I/O:

```js
VERSAO_REGRAS_SCORE = "score-2026-09-08-semente-1"
calcularScore(processo, agora) -> {
  faixa, pontos, confianca, fatores, versao,
  aprovadaPorRisco: false, fonte: "indicio_publico_datajud", ressalva
}
```

Fatores da semente, todos presentes no snapshot normalizado
(`server/handlers/datajud.js:77-95`):

| Fator | Sinal | Por que |
|---|---|---|
| `estagio_tpu` | estágio aprovado em `server/tpu-catalog.js` | Único sinal jurídico curado |
| `idade_processo` | `dataAjuizamento` | Processo antigo tende a estar mais adiantado |
| `grau` | `grau` | G1 sem recurso é mais previsível que instância superior |
| `segmento` | segmento/tribunal derivados do número | Cobertura e ritmo variam por segmento |
| `cadencia_movimentos` | movimentos recentes | Processo parado sinaliza risco de prazo |

Atenção: `idadeEmDias` (`server/p0-core.js:24`) mede a idade do **movimento**,
não do processo — reutilizada para cadência, nunca para idade do processo.

`confianca` é `"baixa"` sem estágio TPU curado — hoje o caso comum, já que
`server/tpu-catalog.js:6` mapeia só o código `12548`. Nenhum rótulo aparece sem
o movimento e a data que o originaram, regra já valendo para estágio
(README:118).

### Persistência

`db/migrations/0004-p2-integracao.sql`, idempotente por construção
(`scripts/migrate.js:16` roda tudo a cada execução, com split por `;`):

- `ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS score_faixa | score_pontos |
  score_versao | score_confianca`. A confiança é coluna porque a tabela do lote e
  as exportações leem só colunas: sem ela, faixa apoiada em movimento TPU curado
  fica indistinguível de faixa tirada só de sinais secundários.
- `CREATE TABLE IF NOT EXISTS service_tokens (...)` — `id`, `creator_user_id` FK
  CASCADE, `nome`, `prefixo`, `token_hash UNIQUE`, `limite_dia`, `criado_em`,
  `ultimo_uso_em`, `revogado_em`, `expires_at`.
- `CREATE TABLE IF NOT EXISTS audit_events (...)` — `actor_type` com CHECK inline
  (`usuario`/`token`/`automacao`), `ator_rotulo`, `user_id`, `service_token_id`,
  `process_id`, `acao`, `recurso`, `resultado`, `req_id`, `created_at`,
  `expires_at`.
- Índices: `audit_events (user_id, created_at DESC)`,
  `audit_events_expires_at_idx`, `service_tokens_expires_at_idx` e o inexistente
  `consultation_events_created_at_idx`.

Proibido na migration: `ALTER TABLE ... ADD CONSTRAINT` (não tem `IF NOT
EXISTS`), bloco `DO $$`, `;` dentro de comentário e comentário solto após o
último `;`.

As três FKs de `audit_events` são **`ON DELETE SET NULL`**, não CASCADE: com
CASCADE, o expurgo de usuário inativo apagaria a trilha junto com o ator,
destruindo justamente a evidência.

### Retenção

`purgeExpired` (`server/db.js:157`) preserva a ordem filha→mãe. As novas
exclusões entram **antes** de `users` e `snapshots`:

```text
audit_events vencidos
consultation_events acima de 180 dias
service_tokens vencidos
...
users / snapshots
```

Token revogado é retido até o próprio prazo — senão a trilha aponta para ator
inexistente. O expurgo grava um `audit_event` de si mesmo, só com contagens:
"expurgo automático" sem registro não é demonstrável.

## Segurança e privacidade

- **Autenticação/autorização.** Token com hash no banco (`hashToken`,
  `server/db.js:11`), comparado por `timingSafeEqual` como em
  `server/auth.js:22`. Autorização dentro do SQL, `null` → 404. Modelo criador:
  cada usuário administra só os próprios tokens e lê só a própria trilha.
- **Dados sensíveis e logs.** Número CNJ nunca inteiro em log — só o sufixo de 4
  dígitos (`server/handlers/datajud.js:34`). A trilha vincula por `process_id`;
  o rótulo do ator é pseudonimizado. Valor do token aparece uma única vez, na
  resposta da emissão.
- **Limites, abuso e falha segura.** `consumirTokenServico` é fail-closed, no
  molde de `consumirMonitoramento` (`server/rate-limit.js:110`): o docx é
  explícito que o limite por token é obrigatório, e consumo externo não pode
  furar a cota da operação quando o Redis cai.

## Alternativas e decisões

| Opção | Decisão | Motivo |
|---|---|---|
| Rota `/api/v1/processos/<numero>` | rejeitada | `rewrites` não aceita wildcard; caminho variável não resolve |
| Function dedicada por rota v1 | rejeitada | Estouraria o teto de 12 do Hobby |
| Calcular score sob demanda na leitura | rejeitada | Lote precisa de faixa em tabela e exportação; recálculo por linha é caro |
| Persistir score no snapshot | escolhida | Segue o precedente de `estagio`/`tpu_versao`: derivado calculado na escrita |
| Suprimir a faixa sem TPU curado | rejeitada | Esconder o resultado é pior que declarar `confianca: "baixa"` |
| `audit_events` com FK CASCADE | rejeitada | O expurgo do ator apagaria a evidência |
| Apagar token revogado na hora | rejeitada | A trilha passaria a apontar para ator inexistente |
| Cota por token fail-open | rejeitada | Consumo externo furaria a cota da operação com o Redis fora |
| Admin global de tokens | rejeitada | Não existe papel de administrador; modelo criador é o do P1 |

**Consequência aceita e documentada:** snapshot antigo mantém a faixa da versão
de regra em que foi gravado. É recalculável por reconsulta.

## Estratégia de testes

- **Unidade.** `tests/node/p2-score.test.js`: faixa, fatores, confiança baixa
  sem TPU curado, ressalva sempre presente, versão fixada.
  `tests/node/ratelimit.test.js`: cota por token e fail-closed.
  `tests/node/handler-dispatch.test.js`: `400 rota_ambigua`.
- **Integração/contrato.** `tests/node/p2-api.test.js` e
  `tests/node/p2-tokens.test.js`: 401 sem token, 401 com token revogado e
  vencido, 429 na cota, isolamento por criador, isolamento da trilha, registro
  das tentativas negadas. `tests/node/db.test.js`: colunas de score no
  `INSERT`/`SELECT`, ordem do expurgo, autorização no SQL.
  `tests/node/module-resolution.test.js`: rotas novas no README, variáveis novas
  no `.env.example`, teto de Functions, rewrites.
- **Regressão manual.** Preview autenticado: emitir token na interface, chamar
  as duas rotas v1 com `curl`, confirmar `401` sem token, `401` com token
  revogado e `429` ao estourar a cota; conferir `GET /api/audit`; disparar o
  schedule assinado de expurgo e comparar contagens; conferir faixa na consulta,
  no lote e nas exportações. `npm run db:migrate` duas vezes seguidas no Neon de
  Preview, provando idempotência.

Testes locais **não** comprovam Entra, Neon, QStash nem Deployment Protection —
README:324 já registra isso.

## Riscos e rollout

- **Slot de Function.** O desenho mantém 11 Functions. Se algum handler novo
  exigir `bodyParser: false`, ele não pode entrar na agregadora e o custo passa
  a ser uma Function (12/12) — sinal para reavaliar antes de codificar.
  Monitorar: contagem de arquivos em `api/`.
- **Score parecer certidão.** Mitigado por `confianca`, `fatores`,
  `aprovadaPorRisco: false`, `fonte` e ressalva ao lado da faixa, em toda saída
  (UI, CSV, XLSX e API v1). Monitorar: revisão da área de risco.
- **Faixa congelada na versão da regra.** Consequência de persistir o score;
  documentada, e recalculável por reconsulta. Monitorar: `score_versao`
  divergente de `VERSAO_REGRAS_SCORE` nas leituras.
- **Token vazado.** Mitigado por hash no banco, prefixo para identificação,
  revogação imediata, cota por token e auditoria de cada uso. Monitorar:
  `ultimo_uso_em` e eventos `token_uso` na trilha.
- **Volume da trilha no Neon gratuito (0,5 GB).** `audit_events` cresce por
  requisição; retenção de 180 dias e expurgo diário são o controle, e
  `docs/retencao.md` declara o crescimento esperado. Monitorar: contagem da
  tabela antes e depois do expurgo.
