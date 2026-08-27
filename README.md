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
- `api/session.js` — login/logout por senha compartilhada e cookie assinado de 8h.
- `api/datajud.js` — proxy serverless para o DataJud (sessão, origem restrita, rate limit,
  taxonomia de erro, log estruturado).
- `server/` — autenticação, origem e rate limit no Upstash Redis via REST.
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

### Rotação da chave do DataJud

A chave é **pública e rotacionada pelo CNJ**, mas não fica no código: existe apenas como
variável de ambiente. Quando o CNJ trocar a chave, pegue a nova em
<https://datajud-wiki.cnj.jus.br/api-publica/acesso>, atualize `DATAJUD_API_KEY` no painel
da Vercel (Production + Preview) e redeploye — sem alterar código.

Se a variável estiver ausente, o proxy responde `500 config_ausente` e registra o evento no
log. Ele **não** cai em uma chave embutida: uma cópia versionada envelhece silenciosamente e
deixa o repositório servindo de proxy gratuito para quem o clonar.

### Acesso

O decodificador offline permanece público. A consulta online exige uma senha compartilhada:
`POST /api/session` cria um cookie `HttpOnly`, `SameSite=Strict`, restrito a `/api`, assinado
por HMAC e válido por 8 horas. `DELETE /api/session` encerra a sessão e limpa o cache DataJud
no navegador. Esta solução não exige plano pago nem dependência externa de autenticação.

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
