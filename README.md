# Decodificador de Número CNJ

Ferramenta interna que decodifica, **offline**, tudo o que está codificado em um número
único de processo do CNJ (Resolução CNJ nº 65/2008) — segmento da Justiça, tribunal,
ano de autuação, unidade de origem e validação do dígito verificador — e, opcionalmente,
enriquece o resultado com os dados públicos do processo na **API Pública do DataJud (CNJ)**.

A decodificação acontece inteiramente no navegador. Só a consulta online, quando o usuário
clica em **Consultar online**, envia o número a um servidor (o proxy `/api/datajud`).

> A base pública do DataJud é **indício, não certidão**. Ela não retorna partes, advogados
> nem valores, e a atualização depende de cada tribunal. Nenhuma decisão de crédito deve
> tratar o retorno como prova.

## Como usar

Para a decodificação offline, `index.html` funciona aberto direto no navegador
(`file://`), sem build e sem dependências.

A **consulta online** exige o proxy serverless, ou seja, o site rodando na Vercel
(`vercel dev` localmente, ou o deployment).

Cole ou digite o número do processo. O campo aplica a máscara
`NNNNNNN-DD.AAAA.J.TR.OOOO` em tempo real e aceita entrada com ou sem pontuação.

## Formato do número

| Parte | Dígitos | Significado |
|-------|---------|-------------|
| `NNNNNNN` | 7 | Número sequencial do processo (por unidade/ano) |
| `DD` | 2 | Dígito verificador (módulo 97, ISO 7064) |
| `AAAA` | 4 | Ano de autuação |
| `J` | 1 | Segmento do Poder Judiciário |
| `TR` | 2 | Tribunal |
| `OOOO` | 4 | Unidade de origem (vara/foro) |

O nome da **unidade de origem** não é resolvido offline (mostramos só o código); quando
a consulta online é feita, o órgão julgador vem no retorno do DataJud.

## Estrutura

- `index.html` — página e marcação.
- `styles.css` — estilos.
- `js/tables.js` — tabelas de mapeamento (segmento, TRF, TRT, TRE, TJ, TJM) e derivação
  do alias do índice DataJud.
- `js/cnj.js` — lógica pura (normalizar, máscara, parse, validar, descrever).
- `js/api.js` — cliente autenticado da consulta online, com cache em `localStorage` (24h).
- `js/app.js` — integração com o DOM.
- `api/session.js` — estado da sessão: modo Entra (GET/DELETE) ou senha compartilhada.
- `api/datajud.js` — proxy serverless para o DataJud (sessão, origem restrita, rate limit,
  taxonomia de erro, log estruturado).
- `api/auth/login.js`, `api/auth/callback.js` — início e conclusão do OIDC no Entra.
- `api/batches/index.js` — cria o lote (`POST`) e devolve status com triagem por linha (`GET`).
- `api/batches/import.js` — importa CSV ou XLSX; o formato vem do `Content-Type`.
- `api/batches/export.js` — baixa o resultado em CSV ou XLSX.
- `api/batch-worker.js` — worker chamado pelo QStash, com assinatura verificada.
- `api/maintenance/purge.js` — expurgo de retenção, também assinado pelo QStash.
- `api/portfolios/` — carteiras P1, itens monitorados e membros compartilhados.
- `api/health-probes.js`, `api/process-history.js` — sondas de tribunal e histórico protegido.
- `api/monitor-worker.js`, `api/health-worker.js`, `api/digest-worker.js` — ticks P1 assinados
  pelo QStash; os respectivos `*-item-worker` executam uma unidade de trabalho.
- `server/` — SSO, banco, fila, validação CNJ, planilhas, origem e rate limit.
- `server/handlers/api-v1.js` — API interna `/api/v1`, autenticada por token de serviço.
- `server/handlers/service-tokens.js`, `server/handlers/audit.js` — emissão/revogação de
  token e leitura da trilha de auditoria, ambas por sessão SSO.
- `server/p2-score.js` — score de elegibilidade (módulo puro, regras versionadas).
- `server/audit.js` — pseudonimização do ator e gravação não fatal da trilha.
- `docs/retencao.md` — política de retenção por tipo de dado.
- `db/migrations/` — esquema Neon; aplicado por `scripts/migrate.js` (`npm run db:migrate`).
- `scripts/check-imports.mjs` — `npm run check`: importa cada módulo para pegar
  especificador quebrado, que `node --check` não detecta.
- `tests/node/` — testes automatizados com o test runner nativo do Node.
- `tests/cnj.test.html` — testes da lógica pura; abra no navegador (todos devem ficar verdes).

Sem bundler, framework ou dependências externas: browser clássico e APIs nativas do Node.

## Configuração

Variáveis documentadas em `.env.example`. Localmente, `vercel env pull` gera o `.env.local`.

| Variável | Obrigatória | Para quê |
|---|---|---|
| `DATAJUD_API_KEY` | sim | Chave da API Pública do DataJud |
| `APP_ACCESS_PASSWORD` | sim | Senha compartilhada (mínimo 16 caracteres) |
| `SESSION_SECRET` | sim | Assina a sessão e pseudonimiza IPs (mínimo 32 caracteres) |
| `UPSTASH_REDIS_KV_REST_API_URL` / `_TOKEN` | recomendada | Criadas pela integração Upstash Vercel; contador do rate limit |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | alternativa | Nomes aceitos para ligação manual ao Upstash |
| `RL_CLIENTE_MIN` / `RL_GLOBAL_MIN` / `RL_GLOBAL_DIA` | não | Limites DataJud (30/min por IP, 300/min e 2.000/dia globais) |
| `RL_LOGIN_15MIN` | não | Tentativas de login por IP em 15 minutos (padrão: 10) |
| `RL_REDIS_TIMEOUT_MS` | não | Timeout do Redis em milissegundos (padrão: 3.000) |
| `M365_TENANT_ID` / `M365_CLIENT_ID` / `M365_CLIENT_SECRET` | modo interno | Aplicação Entra; ativam o SSO |
| `DATABASE_URL` | modo interno | Neon: sessões, snapshots, lotes e auditoria |
| `APP_BASE_URL` | modo interno | Base do redirect URI e do destino dos jobs QStash |
| `SSO_EMAIL_DOMINIO` | não | Domínio de e-mail aceito no login (padrão: `btblue.com.br`) |
| `QSTASH_TOKEN` | lotes | Publica os jobs de triagem |
| `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` | lotes | Verificam a assinatura do worker e do expurgo |
| `QSTASH_URL` | conta fora da região padrão | Endpoint regional do QStash, lido pelo SDK |
| `RESEND_API_KEY` | P1 | Chave de runtime para enviar o digest diário |
| `RESEND_FROM_EMAIL` | P1 | Remetente verificado no Resend para o digest diário |
| `RL_API_TOKEN_DIA` | não | Cota diária padrão de um token de serviço (padrão: 1.000) |
| `RL_API_TOKEN_MIN` | não | Teto por minuto de cada token de serviço (padrão: 60) |

### Rotação da chave do DataJud

A chave é **pública e rotacionada pelo CNJ**, mas não fica no código: existe apenas como
variável de ambiente. Quando o CNJ trocar a chave, pegue a nova em
<https://datajud-wiki.cnj.jus.br/api-publica/acesso>, atualize `DATAJUD_API_KEY` no painel
da Vercel (Production + Preview) e redeploye — sem alterar código.

Se a variável estiver ausente, o proxy responde `500 config_ausente` e registra o evento no
log. Ele **não** cai em uma chave embutida: uma cópia versionada envelhece silenciosamente e
deixa o repositório servindo de proxy gratuito para quem o clonar.

### P0: SSO e persistência

Com `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, `SESSION_SECRET` e
`DATABASE_URL` configurados, a ferramenta entra no modo interno: somente contas
`@btblue.com.br` do tenant Microsoft Entra autenticam, e o login por senha deixa
de ser aceito. Os nomes `ENTRA_*` seguem aceitos só para compatibilidade; não
configure ambos. `SESSION_SECRET` deve ter pelo menos 32 caracteres e assina o
cookie temporário do OIDC.
Cadastre `<APP_BASE_URL>/api/auth/callback` como redirect URI Web no Entra. Rode
`npm run db:migrate` uma vez contra o Neon antes do deploy; snapshots, movimentos
e eventos de consulta expiram após 180 dias. A classificação usa somente códigos
TPU versionados: um código sem curadoria permanece `não classificado` — hoje esse
é o caso comum, já que só `12548` (expedição de alvará) está mapeado. O estágio
aparece no resultado da consulta única, na tabela por linha do lote e na
exportação.

Mesmo com SSO ligado, **a decodificação offline continua pública**: abrir a página
não redireciona ninguém para o Entra. O login só é acionado nas ações que exigem
identidade — consulta online, envio de lote e importação de planilha.

O domínio de e-mail aceito vem de `SSO_EMAIL_DOMINIO` (padrão `btblue.com.br`);
além dele, o `tid` do token precisa bater com `M365_TENANT_ID`.

Sem estas variáveis, o comportamento legado por senha fica somente para
desenvolvimento/homologação. Não configure produção parcialmente.

### P1: carteiras, monitoramento e saúde

A P1 exige o modo interno completo: Microsoft Entra, `DATABASE_URL`, QStash e
Redis configurados. Nenhuma rota P1 aceita a senha compartilhada. As carteiras,
seus membros, itens monitorados, sondas, medições e alertas expiram em até 180
dias; o expurgo assinado existente remove os registros vencidos.

| Rota | Contrato |
|---|---|
| `GET`/`POST`/`PATCH`/`DELETE /api/portfolios` | Lista, cria, renomeia ou exclui uma carteira. Somente o criador altera ou exclui. |
| `GET`/`POST`/`PATCH`/`DELETE /api/portfolios/items?portfolioId=<uuid>` | Lista itens para criador ou membro; somente o criador inclui, muda o intervalo (1–1.440 minutos) ou remove. |
| `GET`/`POST`/`DELETE /api/portfolios/members?portfolioId=<uuid>` | Lista membros ativos; somente o criador convida ou remove por `userId`. |
| `GET`/`POST`/`PATCH`/`DELETE /api/health-probes?portfolioId=<uuid>` | Lê sondas da carteira; somente o criador as administra. A entrada é o número CNJ, e o alias DataJud é derivado no servidor. |
| `GET /api/process-history?numero=<20 dígitos>` | Retorna snapshots reduzidos e transições somente se o processo estiver monitorado em carteira acessível ao usuário. |

Uma consulta DataJud autenticada devolve `processId` junto ao resultado, permitindo ao
criador incluir o processo encontrado em uma carteira aberta. Membros veem as carteiras,
itens, membros, sondas e histórico, mas nenhum controle de escrita. Um usuário sem vínculo
recebe `404`, sem descoberta de outra carteira.

O monitoramento reserva 480 consultas DataJud por dia e as sondas de saúde reservam 120;
os dois usam o mesmo fluxo global de cinco workers. Um alerta só é criado quando existe
transição que envolva estágio TPU aprovado. O digest reúne alertas por destinatário ativo,
tenta no máximo três envios por alerta e só registra sucesso após aceite 2xx do Resend.
Números CNJ nunca entram em logs de workers.

`RESEND_API_KEY` e `RESEND_FROM_EMAIL` existem somente no runtime das funções. Cadastre
ambas na Vercel; não as exponha em JavaScript do navegador, respostas, logs ou documentação.

#### Workers e schedules P1

Os cinco workers P1 aceitam apenas `POST` com assinatura QStash sobre o corpo bruto:

- `/api/monitor-worker` escolhe itens devidos; `/api/monitor-item-worker` consulta um item.
- `/api/health-worker` escolhe sondas devidas; `/api/health-item-worker` mede uma sonda.
- `/api/digest-worker` envia o resumo diário.

Crie os schedules no QStash, nunca em `vercel.json`: os handlers rejeitam chamadas sem
assinatura. Use horários UTC: `0 * * * *` para `/api/monitor-worker` e
`/api/health-worker`; `0 11 * * *` para `/api/digest-worker` (08:00 BRT, UTC-3).
Mantenha o header `Upstash-Forward-x-vercel-protection-bypass` quando Deployment Protection
estiver ativa, como no schedule de expurgo acima. Criação de schedules é operação externa ao
repositório.

### P2: API interna, faixa de prioridade e trilha de auditoria

A P2 exige o mesmo modo interno da P1. Nenhuma rota nova virou Function: todas
entram na Function agregadora existente, via rewrite em `vercel.json`.

| Rota | Autenticação | Contrato |
|---|---|---|
| `POST /api/v1/decodificar` | `Authorization: Bearer` | Decodifica o número e devolve o alias DataJud derivado. Não consulta o DataJud; debita só a cota do token. `valido` é o dígito verificador e nada mais; a existência de índice público fica em `consultaOnlineDisponivel`. |
| `POST /api/v1/processos` | `Authorization: Bearer` | Consulta com cache (snapshot fresco antes do DataJud) e devolve snapshot reduzido, estágio TPU e faixa de prioridade. |
| `GET`/`POST`/`DELETE /api/service-tokens` | Sessão SSO | Lista, emite e revoga tokens. Cada usuário administra somente os próprios. |
| `GET /api/audit?limite=&offset=` | Sessão SSO | Trilha de auditoria do próprio usuário, paginada. |

#### O contrato é o caminho, não a URL da Function

As rotas acima são o contrato público. A URL interna da agregadora
(`/api/p1-query-handler?handler=...`) continua endereçável por acidente do
roteamento da Vercel e **não é contrato**: não a use como endpoint, não a
divulgue, e não conte com ela em integração. Um `?handler=` duplicado na query
responde `400 rota_ambigua` — a Function recusa a ambiguidade em vez de escolher
um dos valores.

#### Emissão, rotação e revogação de token

O token é emitido no painel **Tokens de serviço** da interface. O valor em claro
aparece **uma única vez**, na resposta da emissão: o banco guarda apenas o hash
SHA-256 e o prefixo público (os 8 caracteres depois de `cnjsvc_`), que serve para
identificar qual credencial revogar.

- **Rotacionar** é emitir um token novo, apontar o integrador para ele e revogar
  o antigo — nesta ordem. Não existe "renovar": não há caminho para reexibir um
  segredo.
- **Revogar** vale imediatamente e não apaga a linha; o registro fica até o
  próprio prazo para que a trilha continue apontando para um ator existente.
- Um token de outro criador responde `404 token_nao_encontrado`, sem revelar se
  existe.
- Token revogado, vencido e inexistente respondem todos `401 token_invalido`.

Exemplo de chamada:

```bash
curl -X POST "$APP_BASE_URL/api/v1/processos" \
  -H "Authorization: Bearer $CNJ_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"numero":"00013278820188260344"}'
```

#### Cota por token

Cada token tem um limite diário próprio (padrão `RL_API_TOKEN_DIA`, 1.000) e um
teto por minuto global (`RL_API_TOKEN_MIN`, 60). Estourar qualquer um devolve
`429 limite_excedido` com `Retry-After`. Ao contrário do rate limit do tráfego
manual, esta cota **falha fechada**: sem Redis a chamada é negada, porque consumo
externo não pode furar a cota diária do DataJud reservada à operação. A chamada
que efetivamente alcança o DataJud também debita os contadores globais — e ali a
API interna trata contador indisponível como recusa, em vez de herdar o
fail-open do tráfego manual.

#### Faixa de prioridade

A faixa (`prioridade_alta`, `prioridade_media`, `prioridade_baixa`) é calculada
por `server/p2-score.js` a partir de sinais públicos: estágio TPU aprovado, idade
do processo pelo ajuizamento, grau, segmento e cadência de movimentos. É gravada
no snapshot junto com a confiança e a versão da regra, e aparece na consulta
unitária, na tabela do lote, nas exportações CSV e XLSX e na API v1. O CSV e o
XLSX levam `score_faixa`, `score_confianca`, `score_versao` e `score_ressalva`;
os `fatores` ficam de fora por serem uma lista por linha — quem precisa deles usa
a consulta unitária ou `POST /api/v1/processos`.

> **A faixa é indício, com pesos semente pendentes de aprovação da área de risco.
> Não é decisão de crédito nem certidão.** Por isso ela nunca viaja sozinha: toda
> saída carrega `confianca`, `fatores` (cada um com a própria pontuação e o
> motivo), `versao`, `fonte` e `aprovadaPorRisco: false`. Sem estágio TPU curado
> — hoje o caso comum, já que só o código `12548` está mapeado — a confiança é
> `baixa` e a ressalva declara que o estágio é desconhecido.

Como o score é gravado na escrita, um snapshot antigo mantém a faixa da versão de
regra em que foi gravado; reconsultar o processo recalcula.

#### Trilha de auditoria

Passam a gerar evento: consulta unitária (inclusive servida do cache), consulta
em lote, consultas da automação de monitoramento e de saúde, leitura de
`GET /api/process-history`, exportação de lote, concessão e remoção de membro de
carteira, emissão/uso/revogação de token e recusa por cota — mais as **tentativas
negadas** (401, 403 e 404 cross-portfolio). O expurgo diário também registra a
si mesmo, apenas com contagens.

A trilha **nunca guarda o número CNJ**: o vínculo com o processo é por
`process_id`, e o ator aparece pseudonimizado. Prazos, o que o expurgo apaga e o
crescimento esperado estão em [`docs/retencao.md`](docs/retencao.md).

### Triagem em lote

O painel aceita até 500 números por envio, separados por linha, vírgula ou ponto
e vírgula, ou por arquivo CSV/XLSX de até 2 MiB — ambos os formatos são lidos no
servidor, que escolhe o parser pelo `Content-Type` da requisição, nunca pelo nome
do arquivo. Se houver uma coluna `numero` no cabeçalho, ela é a usada; senão, a
primeira. A validação do dígito e o alias DataJud ocorrem no servidor. Linhas inválidas e duplicadas ficam registradas e
não vão para a fila. Os jobs QStash usam controle global de cinco consultas
paralelas; o estado do lote pode ser consultado em `GET /api/batches?id=<uuid>`
pelo mesmo usuário que o criou, que também devolve a triagem por linha (número,
situação e estágio TPU) exibida no painel. O resultado baixa em CSV ou XLSX; o CSV
trata fórmulas como texto para evitar injeção em planilhas.

Configure `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` e
`QSTASH_NEXT_SIGNING_KEY` na Vercel. Não exponha estas variáveis no navegador.

Se a conta QStash não estiver na região padrão, cadastre também `QSTASH_URL`
(ex.: `https://qstash-us-east-1.upstash.io`). O SDK lê essa variável sozinho;
sem ela o publish vai para o endpoint global e responde
`404 user not found in this region`, e o mesmo endpoint regional vale para as
chamadas de API que criam agendamentos.

O expurgo de retenção fica em `POST /api/maintenance/purge`, que aceita
**somente** requisições assinadas pelo QStash — um Vercel Cron seria rejeitado
com `401 assinatura_invalida`, por isso não há bloco `crons` no `vercel.json`.
Crie o agendamento diário uma vez:

```bash
curl -X POST "https://qstash.upstash.io/v2/schedules/$APP_BASE_URL/api/maintenance/purge" \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: 0 4 * * *" \
  -H "Upstash-Forward-x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"
```

O job apaga sessões e lotes vencidos, snapshots com mais de 180 dias, usuários
sem login no mesmo período e, desde a P2, eventos de auditoria vencidos, eventos
de consulta acima de 180 dias e tokens de serviço vencidos — nesta ordem, antes
de `users` e `snapshots`. Cada execução grava um evento de auditoria de si mesma,
só com as contagens. A política completa está em `docs/retencao.md`.

O cabeçalho `Upstash-Forward-*` só é necessário em deployments com **Deployment
Protection** ligada: sem ele a Vercel responde 302 para o próprio SSO e o job
nunca chega ao handler. O mesmo vale para o worker, que recebe o header de
`server/queue.js`; ali o bypass vai por header e não por query string, porque
`verifyQstash` assina `APP_BASE_URL + req.url` e um parâmetro a mais invalidaria
a assinatura. `VERCEL_AUTOMATION_BYPASS_SECRET` é injetada pela Vercel quando o
bypass está configurado — não precisa cadastrá-la à mão.

Num preview protegido, o login pelo Entra também é interceptado: o navegador
precisa carregar antes `<APP_BASE_URL>/?x-vercel-protection-bypass=<segredo>&x-vercel-set-bypass-cookie=true`,
que grava o cookie de bypass e libera o redirect de volta do Microsoft.

### Acesso legado

O decodificador offline permanece público. A consulta online exige uma senha compartilhada:
`POST /api/session` cria um cookie `HttpOnly`, `SameSite=Strict`, restrito a `/api`, assinado
por HMAC e válido por 8 horas. `DELETE /api/session` encerra a sessão e limpa o cache DataJud
no navegador.

Com o SSO ligado o contrato muda: `POST /api/session` passa a responder
`405 metodo_nao_permitido`, `GET` devolve o usuário autenticado ou
`401 { error: "autenticacao_necessaria", login: "sso" }` — a marca que leva o
cliente ao Entra — e `DELETE` apaga a sessão no banco. O cookie da sessão Entra é
`cnj_sso` (`HttpOnly`, `SameSite=Lax`, `Path=/`, 8 horas), opaco e revogável, ao
contrário do cookie stateless do modo por senha. Esta solução não exige plano pago nem dependência externa de autenticação.

Como a sessão é stateless, logout remove o cookie do navegador, mas não revoga uma cópia do
token até expirar. Se houver suspeita de exposição, troque `SESSION_SECRET` para invalidar
todas as sessões imediatamente.

O login tem limite de 10 tentativas por IP a cada 15 minutos. IPs são armazenados no Redis
somente como HMAC, nunca em texto puro. Por ser senha compartilhada, não há identidade nem
auditoria individual; troque `APP_ACCESS_PASSWORD` quando alguém deixar a equipe.

Sessão e proxy aceitam somente mesma origem. Não há contrato CORS: domínio customizado e
Preview funcionam porque página e `/api/*` são servidos pelo mesmo deployment.

Se o Upstash estiver indisponível, consultas com sessão existente mantêm rate limit
**fail-open**. Novos logins falham fechado (`503 autenticacao_indisponivel`) para impedir
tentativas ilimitadas sem contador.

No plano gratuito atual do Upstash, a cota é 500 mil comandos/mês. Cada consulta consome
6 comandos Redis; o teto padrão de 2.000 consultas/dia equivale a até 360 mil comandos em
30 dias, deixando margem para logins (2 comandos cada). Confira a política vigente antes
de elevar os limites: <https://upstash.com/pricing/redis>.

## Contrato de `/api/session`

- `GET` → `204` com sessão válida; `401 autenticacao_necessaria` sem ela.
- `POST { "senha": "..." }` → `204` e cookie; `401 credenciais_invalidas` se incorreta.
- `DELETE` → `204` e cookie expirado.

## Contrato de `/api/datajud`

`POST { numero, alias }` →

```json
{ "encontrado": true, "total": 2, "processos": [ /* ... */ ] }
```

`processos` vem ordenado por grau (G1, JE, G2, TR, SUP, depois desconhecidos) e, dentro do
mesmo grau, por `dataHoraUltimaAtualizacao` decrescente. O mesmo número costuma existir em
mais de um grau; devolver apenas o primeiro hit omitia justamente a instância mais recente.

Erros vêm como `{ "error": "<codigo>" }`:

| Código | HTTP | Significado |
|---|---|---|
| `numero_invalido` / `alias_invalido` | 400 | Entrada malformada |
| `autenticacao_necessaria` | 401 | Sessão ausente, inválida ou expirada |
| `origem_nao_permitida` | 403 | `Origin` fora da allowlist |
| `metodo_nao_permitido` | 405 | Não é POST |
| `limite_excedido` | 429 | Rate limit (com `Retry-After`) |
| `alias_inexistente` | 502 | O índice do tribunal não existe no DataJud |
| `cota_excedida` | 502 | O DataJud recusou por cota (429) |
| `tribunal_indisponivel` | 502 | O tribunal respondeu 5xx |
| `timeout` | 504 | Estourou o tempo limite (12s) |
| `rede_indisponivel` | 504 | Falha de rede até o DataJud |
| `config_ausente` / `erro_interno` | 500 | Problema nosso |

A separação importa na operação: "não encontrado" e "tribunal fora do ar" levam a decisões
opostas na triagem. O log do proxy emite uma linha JSON por evento (`consulta_ok`,
`indice_vazio`, e cada código de erro) com `alias`, `duracaoMs`, `status` e `reqId`. O número
do processo **nunca** é logado inteiro — só os 4 últimos dígitos.

## Deploy (Vercel)

Site estático + Functions serverless, sem build.

- `vercel.json` — `cleanUrls`, cabeçalhos de segurança (CSP, HSTS, `frame-ancestors`,
  `Permissions-Policy`, `nosniff`, `Referrer-Policy`), os rewrites internos e quais
  branches implantam.
- `.vercelignore` — exclui `tests/` do site publicado (continua versionado no Git).

### Fluxo de branches e ambientes

```text
feature/*  ──▶  develop  ──▶  main
   (sem         (Preview)     (Production)
   deploy)
```

| Branch | Ambiente | Como dispara |
|---|---|---|
| `develop` | Preview | Integração do Vercel com o Git, a cada push/merge |
| `main` | Production | Integração do Vercel com o Git, a cada push/merge |
| qualquer outra | nenhum | Bloqueada em `vercel.json` |

A branch de produção do projeto é `main`; qualquer outra branch habilitada gera
Preview. `develop` tem URL estável
(`cnj-info-extractor-git-develop-<escopo>.vercel.app`), então dá para homologar
sempre no mesmo endereço.

O bloqueio das demais branches fica em `vercel.json`:

```json
"git": {
  "deploymentEnabled": { "main": true, "develop": true, "**": false }
}
```

Sem ele, todo push de branch de trabalho consumiria um deployment e publicaria
uma Preview que ninguém pediu — apontando para o Neon de Preview, com dado
processual real. A regra de sobreposição do Vercel é "basta um padrão
verdadeiro", por isso `**: false` não afeta as duas branches marcadas como
`true`. Para liberar uma branch pontualmente, acrescente-a ao mapa com `true`.

> **Ordem obrigatória em toda promoção.** Aplique `npm run db:migrate` no Neon do
> ambiente alvo **antes** do merge que gera o deploy. As migrações são
> idempotentes e rodam todas a cada execução; um deploy que chega antes da
> migração encontra colunas que ainda não existem. Vale para `develop` (Neon de
> Preview) e para `main` (Neon de Produção).

O merge é o gatilho, e não há gate de teste no caminho: o GitHub Actions roda
`npm test` e `npm run check` em todo push e pull request, mas quem decide o
deploy é a integração do Vercel. Não faça merge com o CI vermelho.

### Limite de Functions no plano Hobby

O projeto usa **11 Functions** sob `api/`, abaixo do limite de 12 do plano Hobby. Os
handlers consolidados ficam em `server/handlers/`; `vercel.json` reescreve cada URL pública
para a Function agregadora correspondente. Assim, URLs e contratos — inclusive assinatura
QStash sobre a URL pública original — permanecem os mesmos. Não volte a expor os módulos em
`api/` sem reduzir o total ou migrar o plano; o teste de resolução impede ultrapassar o teto.

As quatro rotas P2 entraram na mesma agregadora, sem consumir Function nova. Um handler que
precise de `config = { api: { bodyParser: false } }` **não** pode entrar ali, porque a
configuração vale para o arquivo inteiro — nesse caso o custo passa a ser uma Function
(12/12), e a decisão precisa ser reavaliada antes de codificar.

A CSP não permite `unsafe-inline`: **não** introduza `<script>` ou `style=` inline em
`index.html` sem revisar a política.

### Pré-requisitos P1 para Preview e Produção

Antes do deploy, aplique `npm run db:migrate` no Neon do ambiente alvo para executar
`0003-p1-consolidacao.sql` e `0004-p2-integracao.sql` (rode duas vezes seguidas: as
migrações são idempotentes e rodam a cada execução); configure SSO, Redis, QStash, Resend e `APP_BASE_URL` daquele
ambiente; depois crie os três schedules externos. Homologue em Preview autenticado: criar
carteira, convidar membro já existente, adicionar processo a partir da consulta, observar um
tick assinado de monitoramento e de saúde, e validar aceite e recusa do digest. Para a P2,
emita um token na interface, chame `POST /api/v1/decodificar` e `POST /api/v1/processos` com
`curl`, confirme `401` sem token, `401` com token revogado e `429` ao estourar a cota diária;
depois confira em `GET /api/audit` o uso do token, o cache hit e a tentativa negada, e que um
segundo usuário não vê nada disso. Só então repita no ambiente de Produção. Testes locais não
comprovam Entra, Neon, QStash, Resend, schedules nem Deployment Protection.

## Testes

Execute `npm test` e `npm run check`. O GitHub Actions repete ambos em pushes e pull requests.
`tests/cnj.test.html` continua disponível para checagem manual no navegador.

Base normativa: Resolução CNJ nº 65/2008.
