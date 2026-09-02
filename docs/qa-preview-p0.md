---
date: 2026-08-27
keywords: [qa, preview, homologacao, p0]
project: cnj-info-extractor
status: completo — 6 defeitos encontrados, todos corrigidos e reverificados
---

# QA da P0 no ambiente de Preview

Branch `feature/p0-triagem`: defeitos encontrados em `4b1d162`, corrigidos até
`f8dd94d`. Nada foi promovido para produção, nenhuma variável de Production foi
tocada, nenhum merge foi feito.

Ambiente exercitado: Preview em
`cnj-info-extractor-git-feature-0b0bb2-bt-blue-ativos-judiciais.vercel.app`,
Neon de Preview, QStash `us-east-1`, com o header de bypass da Deployment Protection.

Sessões de QA criadas direto no Neon (`qa.a@btblue.com.br`, `qa.b@btblue.com.br`)
para exercitar `currentUser` → `userForSession` sem depender do fluxo interativo
do Entra. Por decisão do usuário, os dados de QA ficaram no banco.

## Veredito

| Fase | Resultado |
|---|---|
| 1 — Regressão local | ✅ 8/8 |
| 2 — E2E por HTTP | ⚠️ 24 casos: 22 ✅, 2 defeitos |
| 3 — TPU com dados reais | ✅ com uma limitação registrada |
| 4 — UI no browser | ⚠️ 8 itens: 7 ✅, 1 defeito |
| 5 — QStash e purge | ✅ 3/4, 1 não observável ainda |

**6 defeitos encontrados — todos corrigidos e reverificados contra o Preview.**

| | Defeito | Natureza | Correção |
|---|---|---|---|
| BUG-5 | estágio TPU some da consulta única sempre que o cache responde | **funcional — matava a feature principal na prática** | `ffb184a`, `ae34df7` |
| BUG-3 | cliente escolhe o índice do DataJud e corrompe o alias gravado | **segurança** | `ae34df7` |
| BUG-6 | worker de lote ignora o cache e reconsulta o DataJud toda vez | quota e crescimento de tabela | `3c9b451` |
| BUG-1 | worker sem assinatura devolve 500 (retentável) em vez de 401 | operacional | `a6edd92` |
| BUG-2 | `numero` volta com espaços à direita nos exports | cosmético no entregável | `f9020df` |
| BUG-4 | 401 de `/api/datajud` cai no diálogo de senha morto | borda (corrida de expiração) | `ae34df7`, `d04bdc2` |

Suíte de 119 para **135 testes**, com os fakes que deixaram os defeitos passar
corrigidos (`f8dd94d`). A reverificação está em "Correções" no fim do documento.

O texto abaixo descreve os defeitos **como encontrados**, antes da correção.

---

## Defeitos

### BUG-1 — worker sem assinatura devolve 500 em vez de 401, e vaza erro interno

`server/queue.js:29` · `api/batch-worker.js:23`

```
POST /api/batch-worker  (sem header upstash-signature)
esperado: 401 {"error":"assinatura_invalida"}
obtido:   500 {"error":"Invalid Compact JWS"}
```

`Receiver.verify` do SDK **lança** quando a assinatura é ausente ou malformada;
só retorna `false` quando ela é bem-formada e não confere. O `if (!await
verifyQstash(...)) return 401` nunca chega a rodar — a exceção sobe para o
`catch` genérico do handler.

Duas consequências:

1. **O QStash trata 5xx como retentável.** Uma requisição não assinada gera 3
   retentativas em vez de ser recusada na hora. Qualquer scanner que bata no
   endpoint multiplica a carga por 4.
2. **A mensagem crua da biblioteca vai para o corpo da resposta.**

Por que os testes não pegaram: `tests/node/queue.test.js:86` mocka o `Receiver`
com um fake que **retorna** `false`. O fake não espelha o contrato real, que é
lançar. É exatamente a mesma classe dos três bugs da sessão anterior.

Correção: envolver o `receiver.verify` em try/catch em `server/queue.js:29`,
retornando `false` na exceção, e ajustar o fake do teste para lançar.

### BUG-2 — `numero` volta preenchido com espaços à direita nos exports

`db/migrations/0001-p0.sql:19,66`

As colunas são `CHAR(20)`. O Postgres preenche `bpchar` com espaços, então
qualquer número com menos de 20 caracteres volta padded — no JSON de
`GET /api/batches`, no CSV e no XLSX.

```
GET /api/batches?id=…
  "numero":"123                 "

CSV exportado:
  2,123                 ,invalido,numero_invalido,
```

Números CNJ válidos têm exatamente 20 dígitos, então só as linhas inválidas são
afetadas — mas o export é justamente o entregável da triagem, e o relatório de
erros sai com lixo. Comparações não quebram (`bpchar` ignora espaço à direita).

Correção: migrar as duas colunas para `VARCHAR(20)`, ou aparar no `SELECT`. A
segunda opção não exige migração e é a mais barata.

### BUG-3 — o cliente escolhe qual índice do DataJud é consultado *(segurança)*

`api/datajud.js:160` e `:186`

A decisão registrada em `docs/session-entra-neon-qstash-xlsx-tpu.md` é: *"Validar
CNJ e derivar alias no servidor — a entrada do browser não deve selecionar um
índice do DataJud."* O caminho de lote cumpre isso (`server/batch-service.js:8`
→ `validarNumeroParaConsulta`, que **deriva** o alias). O caminho de consulta
única **não**: pega o alias do corpo da requisição e valida só o formato contra
`ALIAS_RE`, nunca contra os segmentos J/TR do número.

Prova, com número TJSP novo enviado com alias do TRF1:

```
POST /api/datajud
{"numero":"99991231720198260100","alias":"api_publica_trf1"}
→ 200

SELECT numero, alias FROM processes WHERE numero='99991231720198260100'
→ {"numero":"99991231720198260100","alias":"api_publica_trf1"}
```

O servidor buscou um processo estadual paulista no índice da Justiça Federal da
1ª Região e **gravou o alias forjado no banco**. Como `persistSnapshot` faz
`ON CONFLICT (numero) DO UPDATE SET alias=EXCLUDED.alias`, um usuário autenticado
consegue sobrescrever o alias de qualquer processo já cadastrado.

Impacto: exige sessão válida, então não é exposto a anônimo. Mas (a) a
propriedade de segurança declarada não existe no caminho principal, (b) a chave
do DataJud é usada contra índices arbitrários à escolha do cliente, e (c) o
alias persistido — que é dado de origem do snapshot — pode ser corrompido.

Correção: derivar o alias a partir do número, como o lote já faz, e ignorar o
campo `alias` do corpo (ou rejeitar quando divergir do derivado).

### BUG-4 (menor) — 401 de `/api/datajud` cai no diálogo de senha morto, mas só numa corrida

`api/datajud.js` (o 401 não carrega `login:"sso"`) · `js/api.js:105` · `js/app.js:156`

```
POST /api/datajud sem cookie
obtido: 401 {"error":"autenticacao_necessaria"}     ← sem login:"sso"
```

Todas as rotas irmãs devolvem `{error:"autenticacao_necessaria", login:"sso"}`;
`/api/datajud` não. E `consultarProcesso` (`js/api.js:105`) não checa
`body.login` — só `requisicaoLote` (`:121`, `:149`) faz isso. Quando esse 401
chega ao `js/app.js:156`, ele chama `abrirLogin(digitos)`, que abre o
`#login-dialog` do modo senha compartilhada (`index.html:84`), morto desde que
o SSO entrou.

**Na prática o caminho comum não passa por aí**, e o teste no browser confirmou:
`consultarProcesso` faz `await verificarSessao()` **antes** do POST
(`js/api.js:84`), e `/api/session` devolve `login:"sso"` corretamente. Clicando
em "Consultar online" sem sessão, a página vai direto para o Entra:

```
location.href → login.microsoftonline.com/7447f2b8…/oauth2/v2.0/authorize
                ?client_id=fcef1cf9…&code_challenge_method=S256
                &redirect_uri=…/api/auth/callback
```

O diálogo legado **não** abriu (`document.getElementById('login-dialog').open`
nunca chegou a `true`).

Sobra uma janela estreita: se a sessão expirar *entre* o preflight e o POST — ou
se o `/api/datajud` devolver 401 por outro motivo — o usuário cai no diálogo de
senha morto em vez de ser mandado ao Entra. Sessão de 8 h, então é raro, mas o
caminho existe e é um beco sem saída quando acontece.

Correção (barata): `/api/datajud` inclui `login:"sso"` no 401 quando
`ssoConfigurado()`, e `consultarProcesso` lança `autenticacao_sso` nesse caso,
como `requisicaoLote` já faz. Vale considerar remover de vez o `#login-dialog`
quando o SSO está configurado.

### BUG-5 — a classificação TPU some da consulta única sempre que o cache responde

`api/datajud.js:165` · `server/db.js:40`

O estágio é o entregável da P0, e ele desaparece na segunda consulta em diante:

```
número novo (fresh):
  chaves: ["encontrado","total","processos","estagio"]
  estagio: { estagio: "nao_classificado", …, versao: "tpu-2026-04-09-semente-1" }

mesmo número, repetido (cache):
  chaves: ["total","processos","encontrado","cache"]
  estagio: ausente
```

`freshSnapshot` (`server/db.js:41`) faz `SELECT s.dados` e devolve só o blob. Mas
`persistSnapshot` grava em `dados` a resposta **antes** de anexar o estágio — a
classificação vai para as colunas `estagio`, `estagio_codigo`, `estagio_data` e
`tpu_versao`, que o `SELECT` do cache não lê. O handler então responde
`Object.assign({}, emCache, { cache: "servidor" })`, sem `estagio`.

Confirmado na tela: consultando `0000868-70.2016.5.08.0130` logado, o resultado
renderiza as duas instâncias e todos os movimentos, mas **não existe bloco de
estágio** no DOM (`querySelector('.estagio')` → `null`, e o texto do resultado
não contém a palavra "estágio").

Como o TTL é de 7 dias para `nao_classificado` e 24 h para `expedicao_alvara`,
na prática **só a primeiríssima consulta de cada processo mostra o estágio**.
Todas as demais, durante toda a janela do cache, não mostram. O cache de 24 h no
`localStorage` (`js/api.js:14`) ainda grava esse corpo sem estágio, estendendo o
efeito.

Correção: incluir `estagio, estagio_codigo, estagio_data, tpu_versao` no
`SELECT` de `freshSnapshot` e remontar o objeto `estagio` na resposta do cache.

### BUG-6 — o worker de lote ignora o cache e reconsulta o DataJud toda vez

`api/batch-worker.js:31`

O caminho de consulta única checa `freshSnapshot` antes de ir à rede
(`api/datajud.js:165`). O worker de lote **não**: vai direto para
`consultarDatajud`, sempre.

Medido neste QA, rodando os mesmos três processos em lotes sucessivos:

```
00009978820235070023 | 5 snapshots entre 20:24:20 e 20:33:32
00008687020165080130 | 4 snapshots entre 20:23:45 e 20:33:32
00003483220245080130 | 4 snapshots entre 20:23:25 e 20:32:49
```

Cada snapshot é uma chamada completa ao DataJud **e** a reinserção de todos os
movimentos do processo. A tabela `movements` saiu de 27 para 2 921 linhas em
dez minutos de QA, com três processos distintos.

Consequências: quota do DataJud gasta em dado que o servidor já tem fresco
(o TTL de `nao_classificado` é de 7 dias), crescimento desnecessário de
`snapshots` e `movements`, e latência maior no lote. Num lote de 500 linhas
reprocessado, são 500 chamadas evitáveis.

Correção: o worker consulta `freshSnapshot(item.numero)` antes de chamar o
DataJud e, havendo snapshot válido, finaliza o item reaproveitando-o — mesma
regra que a consulta única já aplica.

---

## Fase 1 — Regressão local ✅

```
npm test         → 119/119
npm run check    → OK: 28 arquivos verificados, 0 com erro
git diff --check → limpo
```

Testes negativos (o que dá valor às defesas criadas na sessão anterior):

| Regressão reintroduzida | `npm run check` | teste |
|---|---|---|
| `api/auth/login.js:1` → `../../../server/sso.js` | exit 1, aponta o arquivo | `module-resolution.test.js` falha |
| `server/db.js:84` → `tx(` no lugar de `tx.query(` | n/a | `db.test.js` 2 de 9 falham |

Ambas as defesas disparam. Árvore restaurada, `git status` limpo.

## Fase 2 — E2E por HTTP

| # | Caso | Esperado | Obtido | |
|---|---|---|---|---|
| 1 | `GET /api/session` sem cookie | 401 + `login:"sso"` | idem | ✅ |
| 2 | `GET /api/session` com cookie QA | 200 + e-mail | idem | ✅ |
| 3 | `POST /api/batches` sem `Origin` | 403 | `origem_nao_permitida` | ✅ |
| 4 | `POST /api/batches` com `Origin` alheia | 403 | `origem_nao_permitida` | ✅ |
| 5 | `POST /api/batches` lista vazia | 400 `lote_vazio` | idem | ✅ |
| 6 | `POST /api/batches` sem o campo | 400 `lote_invalido` | idem | ✅ |
| 7 | `POST /api/batches` `numeros` não-array | 400 `lote_invalido` | idem | ✅ |
| 8 | `POST /api/batches` 501 números | 400 `lote_maior_que_500` | idem | ✅ |
| 9 | `POST /api/batches` só lixo | 202, linhas `invalido` | idem | ✅ |
| 10 | `GET /api/batches?id=` (dono) | 200 + `contagens` + `itens` com `estagio` | idem | ✅ |
| 11 | `GET /api/batches?id=` (outro usuário) | 404 | `lote_nao_encontrado` | ✅ |
| 12 | `GET /api/batches` sem `id` | 400 `lote_invalido` | idem | ✅ |
| 13 | `GET .../export?id=` | 200 `text/csv` + `Content-Disposition` | idem | ⚠️ BUG-2 |
| 14 | `GET .../export?id=&formato=xlsx` | 200 XLSX válido | 2,8 KB, assinatura `PK` | ⚠️ BUG-2 |
| 15 | `POST .../import` `text/csv` | 202 | idem | ✅ |
| 16 | mesmo CSV com Content-Type XLSX | 400 `xlsx_invalido` | idem | ✅ |
| 17 | `POST .../import` `application/json` | 400 `formato_nao_suportado` | idem | ✅ |
| 18 | `POST .../import` sem Content-Type | 400 `formato_nao_suportado` | idem | ✅ |
| 19 | `POST .../import` XLSX real (2,6 KB) | 202 | idem | ✅ |
| 20 | `POST .../import` 2,3 MiB | 400 `arquivo_maior_que_2mb` | idem | ✅ |
| 21 | `POST /api/batch-worker` sem assinatura | 401 | **500** | ❌ BUG-1 |
| 22 | `POST /api/datajud` sem cookie | 401 + `login:"sso"` | 401 sem `login` | ⚠️ BUG-4 |
| 23 | `POST /api/datajud` com cookie, número real | 200 + `estagio` | idem, 2 instâncias | ✅ |
| 24 | idem, repetido | `cache: "servidor"` | idem | ✅ |

O caso 16 é o que prova que o formato vem do `Content-Type` e não do conteúdo
nem do nome do arquivo — o mesmo CSV byte a byte é aceito com um header e
recusado com o outro.

### Ciclo completo da fila

Lote CSV `f31d44fc` (um número válido, um com dígito verificador errado):

```
t+0s   202 { total: 2 }
t+60s  status "processando"  · item 1: processando (erro "timeout" da tentativa anterior)
t+120s status "concluido"    · item 1: concluido, estagio "nao_classificado"
                             · item 2: invalido, erro "digito_verificador_invalido"
```

Eventos do QStash no intervalo:

```
20:14:54 CREATED → ACTIVE
20:15:08 ERROR 500 → RETRY      (timeout do DataJud na 1ª tentativa)
20:15:20 ACTIVE → concluído
```

Ou seja: a retentativa do QStash funcionou de verdade, o `claimBatchItem`
respeitou o limite de tentativas, e o roll-up de status chegou a `concluido`.
Lote XLSX `e05c288f` idem, sem retentativa.

**Observação de semântica, não defeito:** o roll-up (`server/db.js:132`) só
considera `falhou`, não `invalido`. Um lote em que *todas* as linhas são
inválidas termina com status `concluido`, o que na interface lê como sucesso.
Vale decidir se `invalido` deveria puxar o lote para um status próprio.

## Fase 3 — TPU com dados reais ✅

Três números fornecidos pelo usuário, todos trabalhistas, todos encontrados no
DataJud com dado real:

| Número | Alias derivado | Instâncias | Movimentos | Estágio | TTL |
|---|---|---|---|---|---|
| 0000348-32.2024.5.08.0130 | `api_publica_trt8` | G1 + G2 | 91 + 63 = 154 | `nao_classificado` | 168 h |
| 0000868-70.2016.5.08.0130 | `api_publica_trt8` | G1 + G2 | 108 + 169 = 277 | `nao_classificado` | 168 h |
| 0000997-88.2023.5.07.0023 | `api_publica_trt7` | G1 + G2 | 166 + 68 = 234 | `nao_classificado` | 168 h |

Verificado:

- **Ordenação por instância funciona** — G1 antes de G2 nos três, via
  `ordenarInstancias` (`api/datajud.js:98`). Cada número existe em dois graus, e
  o comportamento antigo de devolver só o primeiro hit teria escondido metade.
- **Contagem de movimentos no banco casa exatamente** com a soma das instâncias
  (154, 277, 234) — `persistSnapshot` grava tudo.
- **TTL de 168 h** = o padrão de 7 dias de `ttlPorEstagio` para
  `nao_classificado` (`server/p0-core.js:19`). Correto.
- `tpu_versao` gravada como `tpu-2026-04-09-semente-1` nos três.
- **Cache do servidor funciona**: repetindo a consulta, resposta volta com
  `cache: "servidor"` sem nova ida ao DataJud.

**Nenhum dos três tem o código 12548**, então os três caem em
`nao_classificado` — que é o comportamento correto para a semente atual. Varri
os 665 movimentos por nome atrás de alvará, levantamento, penhora e execução; o
único resultado é `12066 — "Cumprimento de Levantamento da Suspensão"` no
processo do TRT7, que não é alvará. Ou seja: a ausência de classificação aqui é
honesta, não uma falha do mapa.

**Limitação registrada:** o caminho `12548 → expedicao_alvara` (e o TTL de 24 h
que ele dispara) continua coberto apenas por teste unitário. Nenhum dos números
disponíveis exercita a classificação positiva contra a infra real.

### Lote com os três números reais

`5609fe4e` → `202`, e ao final `status: "concluido"`, `contagens: {concluido: 3}`,
as três linhas com `estagio: "nao_classificado"` e `erro: null`. Aqui o alias é
**derivado no servidor** por `prepararLote` → `validarNumeroParaConsulta`, sem
nenhuma entrada do cliente — o oposto do BUG-3.

Exports com dado real, agora sem o padding do BUG-2 (números válidos têm 20
dígitos exatos):

```
linha,numero,status,erro,estagio
1,00003483220245080130,concluido,,nao_classificado
2,00008687020165080130,concluido,,nao_classificado
3,00009978820235070023,concluido,,nao_classificado
```

O XLSX (3,2 KB) foi relido pelo próprio `lerPlanilhaXlsx` e devolveu as mesmas
quatro linhas — ida e volta fecha.

## Fase 4 — UI no browser

Login Entra feito pelo próprio usuário (`gabriel.ribeiro@btblue.com.br`) na
janela controlada; `/api/session` passou a responder 200 e o botão de logout
apareceu.

| # | Item | Resultado |
|---|---|---|
| 1 | Decodificador offline público, sem sessão | ✅ carrega sem redirect; decodifica `0000348-32.2024.5.08.0130` como Justiça do Trabalho / TRT 8ª (PA/AP) / DV **VÁLIDO**; botão de logout oculto |
| 2 | Diálogo de senha legado não aparece | ✅ no caminho comum — "Consultar online" sem sessão vai direto ao Entra (ver BUG-4 para a corrida remanescente) |
| 3 | Consulta única renderiza o estágio | ❌ **BUG-5** — renderiza as 2 instâncias e todos os movimentos, mas o bloco de estágio não existe no DOM |
| 4 | Tabela por linha do lote | ✅ ver abaixo |
| 5 | Import CSV e XLSX pela tela | ✅ ambos geram lote e tabela |
| 6 | Downloads CSV e XLSX | ✅ ambos 200 com `attachment` |
| 7 | Logout | ✅ ver abaixo |
| 8 | Console limpo | ✅ nenhum erro da aplicação |

### Item 3 — consulta única

Consultando `0000868-70.2016.5.08.0130` logado, o painel traz dado real e útil:
duas instâncias (G1/G2 do TRT8), classe "Ação Trabalhista - Rito Ordinário",
órgão julgador "3ª VARA DO TRABALHO DE PARAUAPEBAS", ajuizamento 25/07/2016 e a
lista completa de movimentações datadas. **Falta só o estágio TPU** — BUG-5.

### Item 4 — tabela por linha

Lote pela textarea com os três números reais mais uma linha inválida de
propósito. O `#batch-status` progrediu de `1/4` até `4/4 linhas finalizadas.` e
a tabela renderizou com rótulos em português:

| Linha | Número | Situação | Estágio (TPU) |
|---|---|---|---|
| 1 | 00003483220245080130 | Concluído | Não classificado |
| 2 | 00009978820235070023 | Concluído | Não classificado |
| 3 | 00008687020165080130 | Concluído | Não classificado |
| 4 | 123 | Número inválido — numero_invalido | — |

### Item 5 — imports pela tela

- CSV (`numero` + 2 linhas) → lote criado, `2/2 linhas finalizadas`, tabela com
  os dois números.
- XLSX gerado por `xlsxDeLote` → lote distinto, `2/2 linhas finalizadas`, com os
  números do arquivo (e não os do import anterior).

### Item 6 — downloads

Ambos os links respondem 200 com `Content-Disposition: attachment` e o nome
saneado. CSV 240 bytes começando em `linha,numero,status,erro,estagio\r\n`;
XLSX 3 501 bytes com assinatura `PK` e `[Content_Types].xml`.

### Item 7 — logout

`/api/session` volta a 401 `{"error":"autenticacao_necessaria","login":"sso"}`,
o cookie some do browser, o botão de logout volta a ficar oculto, e o
**decodificador offline continua funcionando** (decodificou
`0000997-88.2023.5.07.0023` normalmente depois do logout).

No banco, a contagem de `sessions` foi de 4 para 3: o logout apagou **apenas** o
token daquele browser, deixando intacta a sessão que o usuário tinha em outro
navegador. É o comportamento correto — `deleteSession` é por token, não por
usuário.

### Item 8 — console

Nenhum erro originado da aplicação. As quatro mensagens presentes são todas do
widget `vercel.live/_next-live/feedback/feedback.js`, que a Vercel injeta em
deployments de Preview e que a **CSP da própria aplicação bloqueia**
(`script-src 'self'`) — junto com os avisos de CORB e de cookie cross-site que
esse bloqueio produz. É a CSP funcionando, não defeito, e não existirá em
produção.

## Fase 5 — QStash e purge

- Purge disparado sob demanda: `DELIVERED / 204`.
- **Purge é inócuo com dado vivo** — contagens idênticas antes e depois nas 8
  tabelas (`users 3, sessions 3, processes 2, snapshots 3, movements 27,
  consultation_events 3, batches 3, batch_items 5`). Nenhuma sessão válida,
  lote ou snapshot recente foi apagado.
- Schedule `scd_4rQaTa2JyMM9peSDuPvW1fwjZH8M` conferido: cron `0 4 * * *`,
  `isPaused: false`, destino correto, header de bypass presente. Criado hoje às
  19:18 UTC, **primeira execução em 2026-08-28 04:00 UTC** — ainda não rodou,
  então o histórico não pode ser avaliado nesta sessão.
- `flowControl.parallelism: 5` continua verificado só por teste unitário; os
  lotes de QA foram pequenos demais para observar o comportamento da fila.

---

## Estado do banco ao fim do QA

Por decisão do usuário, os dados de QA ficaram no Neon de Preview.

```
users 3  ·  sessions 3  ·  processes 7  ·  snapshots 18
movements 2921  ·  consultation_events 18  ·  batches 7  ·  batch_items 16
```

Contém três números CNJ reais e seus movimentos completos — dado processual
ligado a pessoas identificáveis, com retenção de 180 dias. Os 2 921 movimentos
são em boa parte reinserções do BUG-6, não volume legítimo.

Usuários de QA criados: `qa.a@btblue.com.br` e `qa.b@btblue.com.br`, com sessões
válidas por 8 h a partir de 20:11 UTC.

## Pendências

1. **Histórico da execução automática das 04:00 UTC** — o schedule foi criado às
   19:18 UTC de hoje e ainda não disparou sozinho.
2. **Um processo com o código TPU `12548`** para exercitar `expedicao_alvara` e
   o TTL de 24 h contra a infra real. Nenhum dos três números disponíveis tem.
3. `flowControl.parallelism: 5` observado no comportamento da fila — exigiria um
   lote grande o bastante para saturar cinco workers.

## Correções

Sete commits em `feature/p0-triagem`, de `a6edd92` a `f8dd94d`, com o Preview
redeployado a partir de `f8dd94d`. Cada defeito foi reverificado contra a infra
real depois do deploy:

| Defeito | Antes | Depois |
|---|---|---|
| BUG-1 | `500 {"error":"Invalid Compact JWS"}` | **`401 {"error":"assinatura_invalida"}`** |
| BUG-2 | `"numero":"123                 "` | **`"numero":"123"`**, e o CSV sai `4,123,invalido,…` |
| BUG-3 | TJSP + `api_publica_trf1` → 200, alias forjado gravado | **`400 {"error":"alias_invalido"}`**, nada gravado |
| BUG-4 | `401 {"error":"autenticacao_necessaria"}` | **`401 {…,"login":"sso"}`** |
| BUG-5 | resposta de cache sem `estagio` | **`{"cache":"servidor","estagio":{…}}`**; no browser, `.estagio` renderiza "Estágio (TPU): Não classificado" |
| BUG-6 | 3 números → 3 chamadas ao DataJud, 3 snapshots novos | **`snapshots` 18 → 18, `movements` 2921 → 2921**; os três itens apontam para snapshots preexistentes, `tentativas: 1` |

Detalhes que valem registro:

- **A migração rodou sem perda**: contagens idênticas nas 8 tabelas antes e
  depois, `information_schema` confirma `character varying(20)` nas duas colunas,
  e os valores curtos já gravados perderam o padding (`"123"`, `len 3`).
- **BUG-6 medido de ponta a ponta**: o lote de reverificação usou os mesmos três
  números reais e não gerou nenhum snapshot novo. `consultation_events` subiu de
  18 para 21 — o reaproveitamento continua sendo auditado, que é o
  comportamento desejado.
- **Sem alias no corpo agora é aceito**: o servidor deriva
  `api_publica_trt8` sozinho a partir do número e responde normalmente.
- O alias corrompido de `99991231720198260100` (gravado como `api_publica_trf1`
  durante a demonstração do BUG-3, antes da correção) **continua no banco**. É
  artefato do QA num número sintético, não dado real; some no purge de retenção.

### Verificação local

```
npm test         → 135/135  (eram 119)
npm run check    → OK: 28 arquivos verificados, 0 com erro
git diff --check → limpo
```

Os fakes que deixaram os defeitos passar foram corrigidos junto, porque é onde
mora o padrão: `queue.test.js` sempre retornava onde o SDK lança,
`batch-worker.test.js` não conhecia `freshSnapshot`, e os testes de
`api/datajud.js` rodavam só com o SSO desligado — o modo em que o cache e a
dica de login nem existem. Esse último buraco virou `tests/node/datajud-sso.test.js`.

## Antes de produção

Independente das correções, continua valendo o que o QA não cobre e a sessão
anterior já registrou:

- **Rotacionar as quatro credenciais** expostas em conversa (secret do Entra,
  senha do Neon, chaves do QStash, secret de bypass da Vercel). Este QA usou
  todas elas.
- Produção não tem `DATABASE_URL` — hoje roda silenciosamente no modo de senha
  compartilhada legado. Precisa de banco Neon próprio, não o de Preview.
- O schedule de purge aponta para o alias da branch; renomear ou apagar
  `feature/p0-triagem` o deixa batendo em URL morta.

---

## P1 — validação local e homologação pendente

O conteúdo abaixo separa P1 da evidência de Preview registrada acima. P1 foi validada por
testes locais de contratos, automação e interface; **não houve migração P1, deploy, schedule
ou homologação autenticada de P1 neste QA de Preview**.

### Coberto localmente

- Carteiras compartilhadas: criador pode administrar carteira, itens, membros e sondas;
  membro ativo tem somente leitura; ausência de vínculo responde 404.
- Consulta autenticada oferece `processId` para o criador monitorar o processo encontrado.
- Workers verificam assinatura QStash sobre corpo bruto, preservam fluxo global de cinco
  workers e aplicam orçamentos separados de 480 consultas/dia para monitoramento e 120 para
  saúde.
- Alertas surgem apenas em transição envolvendo TPU aprovado; digest agrupa destinatários,
  só marca aceite 2xx do Resend como envio e não registra número CNJ em log.
- Expurgo cobre as tabelas P1 e a retenção de carteiras, sondas, alertas e medições é de
  até 180 dias.

### Necessário antes do Preview P1

1. Aplicar `0003-p1-consolidacao.sql` com `npm run db:migrate` no Neon de Preview.
2. Configurar no Preview `DATABASE_URL`, SSO Entra, Redis, QStash, `APP_BASE_URL`,
   `RESEND_API_KEY` e `RESEND_FROM_EMAIL`; nenhum segredo entra neste documento.
3. Criar no QStash, apontando para URL estável do Preview, schedules assinados: horário para
   `/api/monitor-worker`, horário para `/api/health-worker` e `0 11 * * *` UTC para
   `/api/digest-worker` (08:00 BRT). Incluir bypass Vercel quando Deployment Protection estiver ativa.
4. Homologar com sessão Entra: carteira, convite de membro existente, inclusão a partir de
   consulta DataJud, leitura de histórico, execução dos dois ticks e digest aceito e recusado.
5. Confirmar em logs e no banco que orçamento, assinatura, retenção e dados processuais
   seguem as regras acima, sem número CNJ completo nos logs.

### Produção P1

Produção continua pendente. Repetir os pré-requisitos e a homologação com Neon, Resend,
QStash e `APP_BASE_URL` próprios de Produção. Não promover esta seção local como evidência
de funcionamento em Preview ou Produção.
