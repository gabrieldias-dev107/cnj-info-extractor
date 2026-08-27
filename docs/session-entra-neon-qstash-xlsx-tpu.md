---
date: 2026-08-27
keywords: [entra, neon, qstash, xlsx, tpu]
project: cnj-info-extractor
---

# Session: entra, neon, qstash, xlsx, tpu

## Context
P0 started from `docs/Recomendacoes-de-evolucao-cnj-info-extractor.docx`: internal Microsoft Entra access, Neon persistence, QStash batch processing, CSV/XLSX, and conservative TPU classification. User connected Neon in production and supplied Entra credentials; credentials were not saved.

## Decisions
- **Use `M365_*` names with `ENTRA_*` fallback** — matches Vercel variables already created while preserving compatibility.
- **Sign OIDC state with `SESSION_SECRET`** — prevents state and PKCE verifier tampering.
- **Validate CNJ and derive alias on server** — browser input must not select a DataJud index.
- **Native limited XLSX parser/writer** — avoids reintroducing spreadsheet dependencies with known audit findings; accepts first sheet, 2 MiB maximum, and column `numero`.
- **Exact TPU-only classifier** — only confirmed code `12548` maps to `expedicao_alvara`; names never infer legal stage.

## Solutions & Findings
- `server/sso-config.js:9` — resolves `M365_TENANT_ID`, `M365_CLIENT_ID`, and `M365_CLIENT_SECRET`; SSO also requires `DATABASE_URL` and a 32-character `SESSION_SECRET`.
- `server/sso.js:14` — signs temporary OIDC cookie; `lerStateCookie` rejects forged state/verifier.
- `server/db.js:76` — persists batches and 180-day expiry; `server/db.js:112` claims worker items safely.
- `server/queue.js:6` — QStash flow control uses `parallelism: 5`.
- `api/batch-worker.js:26` — signed QStash worker calls DataJud, writes snapshot and audit event.
- `server/xlsx.js:120` — exports XLSX; parser rejects invalid archives and ignores formula cells.
- `server/p0-core.js:1` — TPU seed version `tpu-2026-04-09-semente-1`.
- Local checks passed before `dec70de`: `npm test` 46/46, `npm run check`, `git diff --check`.

## Commands & Config
```
npm test
npm run check
npm run db:migrate

M365_TENANT_ID=
M365_CLIENT_ID=
M365_CLIENT_SECRET=
SESSION_SECRET=
DATABASE_URL=
APP_BASE_URL=
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
```

Entra redirect URI:
```
<APP_BASE_URL>/api/auth/callback
```

## Files Changed
- `api/auth/*`, `api/session.js`, `server/sso*.js` — Entra authentication and internal browser redirect.
- `db/migrations/0001-p0.sql`, `server/db.js` — Neon schema, session persistence, snapshots, batches, retention.
- `api/batches/*`, `api/batch-worker.js`, `server/queue.js` — authenticated batch intake, import/export, signed worker queue.
- `server/cnj-validation.js`, `server/datajud-client.js`, `server/p0-core.js` — server validation, DataJud worker client, TPU/TTL logic.
- `server/xlsx.js`, `server/batch-export.js` — CSV/XLSX handling without extra dependency.
- `index.html`, `js/api.js`, `js/app.js`, `styles.css` — SSO redirect and triage UI.
- `tests/node/*`, `README.md`, `.env.example`, `package.json` — coverage, operations docs, configuration, checks.

## Blockers & Open Questions
- Rotate the Entra client secret exposed in the conversation; never commit it.
- Production Vercel/Neon/QStash integration was not run from this workspace.
- TPU mapping needs legal validation before adding codes beyond `12548`.
- Static assets remain readable by URL; APIs and interactive flow enforce SSO.

## Next Steps
1. Rotate `M365_CLIENT_SECRET`; configure all listed variables in Vercel Production and Preview.
2. Run `npm run db:migrate` against Neon, then schedule QStash `POST /api/maintenance/purge`.
3. Register Entra Web redirect URI and homologate login, logout, worker signature, one CSV and one XLSX batch.
4. Validate and add TPU mappings with legal approval.
