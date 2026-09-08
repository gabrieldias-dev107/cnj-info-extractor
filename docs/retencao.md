# Política de retenção de dados

Este documento declara **por quanto tempo cada tipo de dado vive** na ferramenta
e **o que o expurgo diário apaga**. Vale para todos os ambientes com o modo
interno ligado (Microsoft Entra + Neon).

O expurgo é `POST /api/maintenance/purge`, aceito somente com assinatura QStash,
agendado uma vez por dia (ver README). Ele não é opcional: sem ele nada abaixo
expira de fato.

## Tabela de retenção

| Dado | Onde | Prazo | Como sai |
|---|---|---|---|
| Sessão do usuário (Entra) | `sessions` | 8 horas | `expires_at` no expurgo; logout apaga na hora |
| Processo consultado | `processes` | enquanto houver snapshot | cai por CASCADE quando o último snapshot sai |
| Snapshot do DataJud | `snapshots` | 180 dias após a consulta | `consultado_em` no expurgo |
| Movimento processual | `movements` | segue o snapshot | CASCADE do snapshot |
| Evento de consulta | `consultation_events` | 180 dias | `created_at` no expurgo |
| **Evento de auditoria** | `audit_events` | **180 dias** | `expires_at` no expurgo |
| Lote de triagem e itens | `batches`, `batch_items` | 180 dias | `expires_at` no expurgo |
| Carteira, membros e itens monitorados | `portfolios`, `portfolio_members`, `monitored_processes` | 180 dias | `expires_at` no expurgo |
| Sonda de tribunal e medições | `health_probes`, `tribunal_health_measurements` | 180 dias | `expires_at` no expurgo |
| Alerta pendente e tentativas de envio | `pending_alerts`, `alert_send_attempts` | 180 dias | `expires_at` no expurgo |
| **Token de serviço** | `service_tokens` | **180 dias a partir da emissão** | `expires_at` no expurgo |
| Usuário sem login | `users` | 180 dias sem `last_login_at` | expurgo; filhos por CASCADE |
| Contadores de rate limit | Redis (Upstash) | 60s ou 24h | TTL da própria chave |

## Decisões que a tabela não mostra

**Token revogado é retido até o próprio prazo.** Revogar preenche `revogado_em`
e o token deixa de autenticar imediatamente, mas a linha fica. Apagá-la deixaria
os eventos de auditoria daquele token apontando para um ator inexistente — ou
seja, destruiria justamente a evidência de que ele foi usado.

**A trilha sobrevive ao ator.** As três chaves estrangeiras de `audit_events`
(`user_id`, `service_token_id`, `process_id`) são `ON DELETE SET NULL`, não
CASCADE. Quando um usuário inativo é expurgado, os eventos dele permanecem, com
o campo de ator nulo e o `ator_rotulo` pseudonimizado preservado.

**A ordem do expurgo vai de filha para mãe.** As tabelas P2 são apagadas antes
de `users` e `snapshots`, para que a exclusão do ator não passe na frente da
expiração dos eventos.

**O expurgo audita a si mesmo.** Cada execução grava um `audit_event` com
`acao: "expurgo_retencao"` e as contagens do que apagou — nada além disso, nenhum
identificador de processo, usuário ou token. Expurgo automático sem registro não
é demonstrável em auditoria.

## O que a trilha nunca guarda

- **Número CNJ inteiro.** A vinculação ao processo é por `process_id`. O mesmo
  vale para logs, que registram no máximo os 4 últimos dígitos.
- **E-mail.** O ator aparece em `ator_rotulo` como HMAC truncado
  (`u_<12 hex>`) ou como o prefixo público do token (`t_<8 caracteres>`).
- **Valor do token de serviço.** O banco guarda apenas o hash SHA-256 e o
  prefixo. O valor em claro existe uma única vez, na resposta da emissão.
- **Payload do DataJud.** Fica em `snapshots.dados`, sujeito ao prazo do
  snapshot, e não é copiado para a trilha.

## Crescimento esperado

`audit_events` cresce por requisição, não por processo — é a tabela que mais
cresce no P2. Ordem de grandeza por linha: ~200 bytes com índices.

| Volume diário | 180 dias | Espaço aproximado |
|---|---|---|
| 500 eventos/dia | 90 mil linhas | ~20 MB |
| 5.000 eventos/dia | 900 mil linhas | ~200 MB |

O plano gratuito do Neon oferece 0,5 GB. A retenção de 180 dias mais o expurgo
diário são o controle; se o volume real passar de ~5.000 eventos/dia, reduza o
prazo de `audit_events` antes de qualquer outra tabela — é a única cujo valor
decai rápido com o tempo.

Meça comparando `count(*)` de `audit_events` antes e depois de um expurgo, e
confira o evento `expurgo_retencao` que a própria execução registra.

## Quem lê a trilha

`GET /api/audit` devolve **somente os eventos do próprio usuário**, paginados. O
escopo vem do SQL (`WHERE user_id = $1`), não de parâmetro. Não existe papel de
administrador global: quem precisa de uma visão consolidada consulta o Neon
diretamente, com a credencial de banco, e isso é operação fora da ferramenta.
