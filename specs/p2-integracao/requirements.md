# Requisitos — P2: API interna, score de elegibilidade e trilha de auditoria

## Contexto

O roadmap (`docs/Recomendacoes-de-evolucao-Rev2-custo-zero.docx`, seção 8) define
P2 / Fase 4 como três entregas: (12) API interna com token de serviço,
(13) score de elegibilidade para antecipação e (14) trilha de auditoria com
política de retenção.

Três lacunas concretas hoje:

- **Integração.** Outros sistemas da BT Blue precisam decodificar e enriquecer
  números CNJ sem reimplementar dígito verificador nem derivação de alias. Só o
  navegador autenticado por SSO consegue chamar a ferramenta.
- **Priorização.** A operação recebe listas grandes e ordena por intuição. Não
  existe critério explícito e auditável para focar a fila de análise.
- **Conformidade.** `consultation_events` (`db/migrations/0001-p0.sql:45`) grava
  só `user_id`, `process_id`, `origem` e `created_at`. Não cobre cache hit nem
  automação, não tem índice e não é expurgada — só cai por CASCADE quando o
  usuário fica 180 dias sem login. Não há política de retenção declarada por
  tipo de dado, nem leitura da trilha.

## Objetivo

Contrato `/api/v1` versionado e limitado por token de serviço; faixa de
prioridade derivada de regras versionadas e auditáveis; trilha de auditoria
consultável, com retenção declarada e efetivamente expurgada.

## Escopo

### Incluído

- `POST /api/v1/decodificar` e `POST /api/v1/processos`, autenticados por
  `Authorization: Bearer <token de serviço>`.
- Emissão, listagem e revogação de tokens de serviço pelo próprio criador
  (`GET`/`POST`/`DELETE /api/service-tokens`), com sessão SSO.
- Cota por token (minuto e dia), fail-closed.
- Módulo puro de score (`server/p2-score.js`) com faixa, pontos, fatores,
  confiança, versão de regra e ressalva.
- Persistência da faixa no snapshot e exibição na consulta unitária, na tabela
  do lote e nas exportações CSV e XLSX.
- Tabela `audit_events`, gravação nos pontos cegos atuais (inclusive negativas),
  leitura paginada em `GET /api/audit` e expurgo por retenção.
- `docs/retencao.md` com a tabela de retenção por tipo de dado.

### Não incluído

- Decisão de crédito automatizada. A faixa é indício, nunca deferimento.
- Aprovação dos pesos do score pela área de risco. Esta entrega usa pesos
  semente, declarados como pendentes.
- Administração de tokens de terceiros. O modelo é criador, igual às carteiras.
- Curadoria de novos códigos TPU. `server/tpu-catalog.js` continua com um código.
- Novas Functions na Vercel. As rotas entram na agregadora existente.

## Requisitos funcionais

### API interna (12)

- WHEN a requisição chega em `/api/v1/*` sem `Authorization: Bearer`, THE SYSTEM
  SHALL responder `401 { "error": "token_ausente" }`.
- WHEN o token apresentado não corresponde a nenhum `token_hash` ativo,
  THE SYSTEM SHALL responder `401 { "error": "token_invalido" }` e registrar a
  tentativa negada na trilha.
- IF o token está revogado ou vencido, THEN THE SYSTEM SHALL responder
  `401 token_invalido`, sem distinguir revogado de inexistente na resposta.
- WHEN `POST /api/v1/decodificar` recebe um número CNJ válido, THE SYSTEM SHALL
  devolver a decodificação (sequencial, dígito, ano, segmento, tribunal, origem)
  e o alias DataJud derivado, sem consultar o DataJud.
- WHEN `POST /api/v1/processos` recebe um número CNJ válido, THE SYSTEM SHALL
  devolver snapshot reduzido, estágio TPU e score, servindo do cache quando
  houver snapshot fresco e consultando o DataJud somente na ausência dele.
- THE SYSTEM SHALL autenticar `/api/v1/*` exclusivamente por Bearer: cookie de
  sessão é ignorado e `origemPermitida` não é aplicado.
- THE SYSTEM SHALL recusar Bearer nas rotas de sessão, que seguem exigindo
  `origemPermitida` → `ssoConfigurado` → `currentUser`.
- WHEN uma resposta `/api/v1/*` é emitida, THE SYSTEM SHALL enviar
  `Cache-Control: no-store`.
- WHEN a decodificação é devolvida por `/api/v1/decodificar`, THE SYSTEM SHALL
  reportar em `valido` somente o dígito verificador, deixando a existência de
  índice público no DataJud para `consultaOnlineDisponivel`.
- IF o contador global de consultas ao DataJud está indisponível, THEN THE SYSTEM
  SHALL recusar a chamada de `/api/v1/processos`, sem herdar o fail-open que o
  tráfego manual com sessão tem por desenho.
- IF o corpo recebido não é um objeto JSON não nulo, THEN THE SYSTEM SHALL
  responder erro estruturado, nunca exceção não tratada.
- WHEN o parâmetro `handler` da Function agregadora chega como array,
  THE SYSTEM SHALL responder `400 { "error": "rota_ambigua" }` sem executar
  handler algum.

### Tokens de serviço

- WHEN o usuário autenticado chama `POST /api/service-tokens` com um nome,
  THE SYSTEM SHALL gerar o token, gravar somente o hash e o prefixo, e devolver
  o valor em claro uma única vez.
- THE SYSTEM SHALL listar e revogar apenas os tokens cujo `creator_user_id` é o
  próprio usuário; token de outro criador responde `404 token_nao_encontrado`.
- WHEN um token é usado, THE SYSTEM SHALL atualizar `ultimo_uso_em`.
- WHEN o consumo do token excede `limite_dia` ou o teto por minuto, THE SYSTEM
  SHALL responder `429 limite_excedido` com `Retry-After` e registrar a recusa.
- IF o contador de cota está indisponível, THEN THE SYSTEM SHALL negar a chamada
  (fail-closed).

### Score de elegibilidade (13)

- WHEN um processo é normalizado, THE SYSTEM SHALL calcular
  `{ faixa, pontos, confianca, fatores, versao, aprovadaPorRisco, fonte,
  ressalva }` a partir de regras versionadas.
- THE SYSTEM SHALL usar as faixas neutras `prioridade_alta`,
  `prioridade_media` e `prioridade_baixa`.
- IF nenhum estágio TPU curado foi encontrado, THEN THE SYSTEM SHALL manter o
  cálculo, marcar `confianca: "baixa"` e declarar a ressalva de estágio
  desconhecido.
- THE SYSTEM SHALL expor `aprovadaPorRisco: false` e
  `fonte: "indicio_publico_datajud"` em toda saída que contenha a faixa.
- THE SYSTEM SHALL listar em `fatores` cada `{ fator, pontos, motivo }` que
  compôs a pontuação.
- WHEN um snapshot é persistido, THE SYSTEM SHALL gravar `score_faixa`,
  `score_pontos`, `score_versao` e `score_confianca`, como já faz com `estagio` e
  `tpu_versao`.
- THE SYSTEM SHALL exibir a faixa sempre acompanhada de `confianca` e ressalva,
  na consulta unitária, na tabela do lote, no CSV, no XLSX e na API v1.

### Trilha de auditoria e retenção (14)

- WHEN qualquer um dos eventos abaixo ocorre, THE SYSTEM SHALL gravar um
  `audit_event` com ator, ação, recurso, resultado e `req_id`: consulta unitária
  servida do cache, consulta da automação de monitoramento e de saúde, leitura
  de `GET /api/process-history`, exportação de lote, concessão e remoção de
  membro de carteira, emissão, uso, revogação e recusa por cota de token.
- WHEN uma tentativa é negada (401, 403 ou 404 cross-portfolio), THE SYSTEM SHALL
  gravar o evento com o `resultado` correspondente.
- WHEN uma requisição às rotas de sessão do P2 é recusada por origem, por
  ausência de sessão ou por apresentar Bearer, THE SYSTEM SHALL registrar a
  negativa com ator anônimo, antes de responder.
- THE SYSTEM SHALL vincular o evento ao processo apenas por `process_id`; o
  número CNJ nunca é gravado na trilha nem em log.
- THE SYSTEM SHALL pseudonimizar o rótulo do ator.
- WHEN `GET /api/audit` é chamado com sessão SSO, THE SYSTEM SHALL devolver
  apenas os eventos do próprio usuário, paginados.
- WHEN o ator é apagado, THE SYSTEM SHALL preservar o evento: as três FKs de
  `audit_events` são `ON DELETE SET NULL`.
- WHEN o expurgo diário roda, THE SYSTEM SHALL apagar `audit_events` vencidos,
  `consultation_events` acima de 180 dias e `service_tokens` vencidos, antes de
  `users` e `snapshots`, e registrar um `audit_event` do próprio expurgo com as
  contagens.
- THE SYSTEM SHALL reter token revogado até o próprio `expires_at`, para que a
  trilha não aponte para ator inexistente.

## Requisitos não funcionais

- **Segurança e autorização.** Token guardado apenas como hash; comparação por
  tempo constante. Autorização dentro do SQL (`AND creator_user_id = $N AND
  expires_at > now()` + `RETURNING`), `null` → 404. SQL sempre parametrizado.
  Erro sempre `{ "error": "<codigo_pt>" }`; `401` de sessão leva `login: "sso"`.
- **Desempenho e limites.** Nenhuma Function nova: o teto de 12 do plano Hobby
  precisa continuar com folga (11 arquivos em `api/`). Cota por token
  fail-closed; a rota que alcança o DataJud também debita os contadores globais.
- **Observabilidade e privacidade.** Número CNJ nunca inteiro em log — só o
  sufixo de 4 dígitos. Trilha com índice `(user_id, created_at DESC)` e
  `expires_at`; `consultation_events` ganha índice por `created_at`.
- **Compatibilidade e acessibilidade.** Migration idempotente (roda a cada
  execução, split por `;`). Interface por DOM/`textContent`, sem `innerHTML` com
  dado remoto, sem `<script>` ou `style=` inline (a CSP de `vercel.json:27` não
  permite `unsafe-inline`).

## Critérios de aceite

- [ ] `POST /api/v1/decodificar` com Bearer válido devolve decodificação e alias
      sem tocar no DataJud; sem header devolve `401 token_ausente`.
- [ ] `POST /api/v1/processos` serve do cache quando há snapshot fresco e
      devolve faixa, `confianca`, `fatores` e ressalva.
- [ ] Token revogado e token vencido devolvem `401 token_invalido`.
- [ ] Estourar `limite_dia` devolve `429 limite_excedido`; com o contador
      indisponível a chamada é negada.
- [ ] `?handler=` em array devolve `400 rota_ambigua` sem executar handler.
- [ ] Um segundo usuário não vê nem revoga tokens de outro criador, e não lê a
      trilha alheia.
- [ ] Score sem estágio TPU curado devolve faixa com `confianca: "baixa"` e
      ressalva preenchida.
- [ ] Faixa aparece na consulta unitária, na tabela do lote, no CSV e no XLSX.
- [ ] `GET /api/audit` lista uso de token, cache hit e tentativa negada.
- [ ] `purgeExpired` apaga os registros vencidos das tabelas novas e grava o
      evento de auditoria do próprio expurgo.
- [ ] Número com dígito verificador correto num segmento sem índice público sai
      com `valido: true` e `consultaOnlineDisponivel: false`.
- [ ] Contador global indisponível recusa `POST /api/v1/processos` sem chamar o
      DataJud.
- [ ] Corpo `null` responde `{ error }`, sem exceção não tratada.
- [ ] Recusa por origem, por sessão e por Bearer nas rotas de sessão aparece na
      trilha como negativa anônima.
- [ ] `npm test` e `npm run check` verdes; `api/` continua com 11 arquivos.

## Questões em aberto

- Pesos e cortes de faixa do score são semente. Responsável: área de risco.
  Condição para decisão: revisão dos fatores propostos em `server/p2-score.js`
  contra uma amostra real de carteira. Até lá `aprovadaPorRisco` permanece
  `false`.
- Volume de `audit_events` no Neon gratuito (0,5 GB) só é mensurável em produção.
  Condição de revisão: primeira medição de crescimento após 30 dias de uso.
