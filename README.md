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
- `server/` — SSO, banco, fila, validação CNJ, planilhas, origem e rate limit.
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

O expurgo de retenção fica em `POST /api/maintenance/purge`, que aceita
**somente** requisições assinadas pelo QStash — um Vercel Cron seria rejeitado
com `401 assinatura_invalida`, por isso não há bloco `crons` no `vercel.json`.
Crie o agendamento diário uma vez:

```bash
curl -X POST "https://qstash.upstash.io/v2/schedules/$APP_BASE_URL/api/maintenance/purge" \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: 0 4 * * *"
```

O job apaga sessões e lotes vencidos, snapshots com mais de 180 dias e usuários
sem login no mesmo período.

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

Site estático + uma função serverless, sem build. Deploy automático a cada `git push`.

- `vercel.json` — `cleanUrls` e cabeçalhos de segurança (CSP, HSTS, `frame-ancestors`,
  `Permissions-Policy`, `nosniff`, `Referrer-Policy`).
- `.vercelignore` — exclui `tests/` do site publicado (continua versionado no Git).

A CSP não permite `unsafe-inline`: **não** introduza `<script>` ou `style=` inline em
`index.html` sem revisar a política.

## Testes

Execute `npm test` e `npm run check`. O GitHub Actions repete ambos em pushes e pull requests.
`tests/cnj.test.html` continua disponível para checagem manual no navegador.

Base normativa: Resolução CNJ nº 65/2008.
