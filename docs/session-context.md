# Contexto de sessão

## 2026-08-27 — P0 de triagem interna

- Branch: `feature/p0-triagem`; commit-base: `dec70de`.
- Entregue: Microsoft Entra SSO (`M365_*`), estado OIDC assinado, Neon com retenção de 180 dias, lotes QStash com cinco workers, importação/exportação CSV/XLSX e validação CNJ no servidor.
- Verificado: `npm test` (46 testes), `npm run check` e `git diff --check`.
- Pendente externo: rotacionar segredo Entra exposto, configurar variáveis, executar `npm run db:migrate` e homologar Vercel/Neon/QStash.
- TPU: somente código `12548` confirmado; ampliar após validação jurídica.

Regra: atualizações futuras de memória de sessão deste projeto devem ser adicionadas neste arquivo, sem segredos.
