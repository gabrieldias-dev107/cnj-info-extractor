---
date: 2026-08-26
keywords: [datajud-proxy, rate-limit, xss-hardening, observability, csp]
project: cnj-info-extractor
---

# Session: datajud-proxy, rate-limit, xss-hardening

## Context

`docs/Recomendacoes-de-evolucao-cnj-info-extractor.docx` (26/08/2026) lista, na seção 4, cinco achados (A1–A5) que são pré-condição para o serviço aguentar uso interno, mais um complemento de cabeçalhos HTTP. Todos foram confirmados no código e corrigidos nesta sessão. Escopo fechado em **A1–A5 + headers**; testes em CI ficaram explicitamente de fora (item da Fase 2 do roadmap).

Estado ao final: código corrigido e verificado, **nada commitado**, e três passos manuais no painel da Vercel ainda pendentes (ver Blockers).

## Decisions (registro histórico; substituídas pela atualização de 27/08 abaixo)

- **Auth por Vercel Deployment Protection (SSO), não por gate próprio** — bloqueia site e `/api/*` no edge sem código de login; custo é configuração, não desenvolvimento. Alternativas descartadas: cookie assinado com senha compartilhada (identidade fraca, sem auditoria por pessoa) e IdP corporativo (1–2 dias, adiado).
- **Rate limit no Upstash Redis, acessado pela REST API com `fetch` puro** — contador precisa ser atômico e compartilhado entre instâncias; com Fluid Compute um `Map` em memória limitaria por instância, não globalmente. Usar a REST API em vez do SDK `@upstash/redis` preserva o princípio do projeto: **sem `package.json`, sem bundler, sem build**.
- **Rate limit fail-open quando o Upstash cai** — queda do Redis não deve derrubar a ferramenta; a autenticação da Vercel continua sendo a barreira primária. A lacuna fica visível pelo evento `rate_limit_indisponivel` no log.
- **Não reescrever o histórico Git para remover a chave** — `FALLBACK_KEY` é a chave *pública* que o próprio CNJ publica na documentação, não um segredo. Ela sai do repositório para que a rotação vire troca de env var em vez de deploy, mas o commit `aaad257` pode ficar como está.
- **Contrato da resposta vira lista (`processos[]`), não item** — o mesmo número existe em mais de um grau; devolver só `hits[0]` omitia justamente a instância mais recente, que é o que a triagem precisa.
- **Cache do browser com prefixo novo (`datajud:v2:`) em vez de código de migração** — entradas no formato antigo simplesmente deixam de ser lidas.
- **`escapeHtml` removido em vez de corrigido** — com todo dado externo entrando por `textContent`, manter a função escapando `'` só convidaria alguém a voltar a interpolar HTML.
- **Fallback de origem = host do próprio deployment** — as URLs de preview da Vercel são dinâmicas; exigir `ALLOWED_ORIGINS` para elas quebraria todo preview.
- **Desvio do plano aprovado:** o plano dizia que `styles.css` não mudaria. Mudou (26 linhas) — as abas de instância são marcação nova e ficariam sem estilo.

## Solutions & Findings

Achados confirmados no código antes da correção:

- `api/datajud.js:12` — **A1** `FALLBACK_KEY` hardcoded e versionada.
- `api/datajud.js:41` — **A2** handler aceitava qualquer POST de qualquer origem.
- `api/datajud.js:85` — **A3** `hits.hits[0]._source` descartava os demais graus.
- `js/app.js:232` (antigo) — **A4** `escapeHtml` não tratava `'`; dado do DataJud interpolado em `innerHTML` em `render`, `renderOnline`, `itemMov`, `card`.
- `api/datajud.js:93-99` (antigo) — **A5** o `catch` genérico devolvia **504 até para bug de código nosso**, indistinguível de falha do DataJud. Esse foi o ponto central de A5.
- `vercel.json` — só `X-Content-Type-Options` e `Referrer-Policy`; a página era enquadrável por qualquer site.

Correções:

- `api/datajud.js:62` `authHeader()` — lança `config_ausente` **antes de qualquer rede** quando `DATAJUD_API_KEY` falta → `500`, nunca 504.
- `api/datajud.js` `origemPermitida()` — aceita host do deployment + `ALLOWED_ORIGINS`; sem header `Origin`, só passa com `Sec-Fetch-Site: same-origin` (curl não passa). Responde `Vary: Origin`.
- `api/datajud.js` `ordenarInstancias()` (exportada) — rank `G1(1) < JE(2) < G2(3) < TR(4) < SUP(5) < desconhecido(99)`; dentro do mesmo grau, `dataHoraUltimaAtualizacao` decrescente.
- `api/datajud.js` `log()` — uma linha JSON por evento. **O número do processo nunca é logado inteiro** — só os 4 últimos dígitos (`…0344`), porque dado processual vincula-se a pessoa identificável e ainda não há política de retenção.
- `api/_ratelimit.js` — `INCR` + `EXPIRE ... NX` em um único round-trip pelo `/pipeline` do Upstash. `EXPIRE NX` dá **janela fixa**; sem `NX` a janela se renovaria a cada requisição e nunca expiraria sob carga.
- `js/app.js` — helpers `el()` / `anexar()` / `card()` / `limpar()`; `anexar` aceita string, `Node` ou array, o que evita montar HTML só para encostar um badge no valor de um card.

Taxonomia de erro implantada (código → HTTP): `config_ausente` 500, `origem_nao_permitida` 403, `limite_excedido` 429, `alias_inexistente` 502, `cota_excedida` 502, `tribunal_indisponivel` 502, `timeout` 504, `rede_indisponivel` 504, `erro_interno` 500.

## Commands & Config

Verificação executada nesta sessão (Vercel CLI **não** instalada; tudo com `req`/`res` falsos, `fetch` mockado e um Upstash falso em HTTP local). Scripts em
`C:\Users\SPOCK\AppData\Local\Temp\claude\C--workspace-repositorios-cnj-info-extractor\5a766c31-e002-44d6-a2a9-a26ae25f3793\scratchpad\`:

```bash
node verify.mjs    # 29 checks: A1, origem, ordenação, taxonomia, redação do log
node verify2.mjs   # 29 checks: render com payload de injeção + rate limit
node verify3.mjs   # 3 checks: 429 fim a fim com Retry-After

# testes puros existentes rodando em Node (sem browser), 34/34 verdes:
node -e "
const fs=require('fs'),vm=require('vm');
const g={};g.window=g;g.globalThis=g;
const ctx=vm.createContext(g);
for(const f of ['js/tables.js','js/cnj.js','tests/cnj.test.js'])
  vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
const res=g.CNJ_TESTS.runAll();
const fail=res.filter(r=>!r.ok);
console.log(res.length-fail.length+'/'+res.length+' passaram');
"
```

Env vars (documentadas em `.env.example`):

```
DATAJUD_API_KEY=          # obrigatória; sem ela -> 500 config_ausente
ALLOWED_ORIGINS=          # opcional; o host do deployment já é aceito
UPSTASH_REDIS_REST_URL=   # injetadas pela integração do Marketplace
UPSTASH_REDIS_REST_TOKEN=
# RL_CLIENTE_MIN=30  RL_GLOBAL_MIN=300  RL_GLOBAL_DIA=2000
```

CSP aplicada (sem `unsafe-inline` — `index.html` não tem script/style inline; o único inline do projeto está em `tests/cnj.test.html`, já excluído pelo `.vercelignore`):

```
default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self';
img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'
```

## Files Changed

Nada commitado. `git diff --stat`: 7 arquivos, +526/−149, mais 2 novos.

- `api/datajud.js` — reescrita substancial: A1, A2, A3, A5.
- `api/_ratelimit.js` — **novo**. Prefixo `_` impede que a Vercel exponha como rota.
- `js/app.js` — camada de render toda por nós de DOM; `escapeHtml` removido; `mensagemErro()` ganhou os códigos novos; abas de instância.
- `js/api.js` — contrato `{ encontrado, total, processos[] }` + cache `datajud:v2:`.
- `vercel.json` — CSP, HSTS, `X-Frame-Options`, `Permissions-Policy`.
- `styles.css` — `.instancias` / `.instancia-btn` (desvio do plano, ver Decisions).
- `README.md` — estava desatualizado (descrevia o projeto como totalmente offline). Agora documenta consulta online, env vars, rotação da chave, contrato do endpoint, taxonomia de erro e a dívida de teste.
- `.env.example` — **novo**; `.gitignore` ganhou `!.env.example`.
- Sem mudança: `js/cnj.js`, `js/tables.js`, `index.html`, `tests/`.

## Blockers & Open Questions (registro histórico; ver atualização abaixo)

- **Três passos manuais no painel da Vercel, pendentes. Sem eles A1/A2 não fecham:**
  1. Settings → Deployment Protection → Vercel Authentication = **Standard Protection** (Production + Preview).
  2. Marketplace → **Upstash Redis** conectado ao projeto (injeta as duas env vars).
  3. `DATAJUD_API_KEY` definida em Production + Preview + Development.
- **Vercel CLI não instalada** nesta máquina (`npm i -g vercel`) — nenhum teste com rede real ou header HTTP de verdade foi executado.
- **Dívida assumida:** `ordenarInstancias()` e a taxonomia de erro vivem em `api/datajud.js` (ESM em Node) e **não têm teste automatizado** — o runner `tests/cnj.test.html` é aberto à mão e só alcança os scripts clássicos do browser. Registrado no README.
- **Deployment Protection exige plano Pro/Team** e conta no time Vercel para cada colaborador — não foi confirmado se isso está resolvido.
- A ordenação por grau assume os valores `G1/G2/JE/TR/SUP` do DataJud; valores fora dessa lista caem no rank 99 sem aviso.

## Next Steps (registro histórico; ver atualização abaixo)

1. Executar os três passos manuais no painel da Vercel (lista acima).
2. `npm i -g vercel && vercel link && vercel env pull && vercel dev` — repetir a verificação com rede real: `403` para origem estranha, 35 requisições/min gerando `429`, e conferir as chaves `rl:cli:*` / `rl:glb:*` no console do Upstash.
3. Consultar um número que exista em mais de um grau (TJSP ou TRT com recurso) e confirmar `total > 1`, a ordem G1 antes de G2 e as abas na interface.
4. Deploy de preview e `curl -I <url>` conferindo CSP/HSTS/`Permissions-Policy`; carregar a página com o console aberto para confirmar zero violação de CSP; tentar embutir em `<iframe>` de outra origem.
5. Commitar (branch, não direto em `main`) — nada foi commitado nesta sessão.
6. Fase 2 do roadmap, começando pelo item que fecha a dívida: `package.json` + `node:test`, extração da lógica pura para módulos importáveis, e workflow do GitHub Actions bloqueando merge vermelho.
# Atualização — autenticação gratuita da consulta online (2026-08-27)

Esta atualização substitui a decisão anterior de usar Deployment Protection e os itens de
testes/CI marcados como pendentes acima. Motivo: no plano Hobby, proteger domínio de produção
exigiria upgrade; o gate próprio mantém somente a consulta online protegida sem custo.

Implementação acrescentada na branch `feature/datajud-security-hardening`:

- decodificador offline continua público;
- `/api/session` oferece login por senha compartilhada, sessão HMAC de 8 horas e logout;
- cookie `cnj_session`: `HttpOnly`, `SameSite=Strict`, `Path=/api`, `Secure` em HTTPS;
- `/api/datajud` valida sessão antes de Redis ou DataJud;
- login limitado a 10 tentativas por IP/15 minutos e fail-closed quando Redis falha;
- consultas autenticadas mantêm rate limit fail-open; limite diário padrão reduzido para 2.000;
- IP usado nas chaves Redis é pseudonimizado por HMAC;
- cache DataJud só é lido após confirmação da sessão e é apagado no logout;
- testes Node sem dependências e CI GitHub Actions com Node 22.

Variáveis novas: `APP_ACCESS_PASSWORD` (mínimo 16 caracteres), `SESSION_SECRET` (mínimo
32 caracteres) e, opcionalmente, `RL_LOGIN_15MIN`. Senha compartilhada não fornece
identidade nem auditoria individual; rotação manual é necessária ao mudar a equipe.
