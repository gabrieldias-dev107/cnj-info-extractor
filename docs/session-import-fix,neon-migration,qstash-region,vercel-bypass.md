---
date: 2026-08-27
keywords: [import-fix, neon-migration, qstash-region, vercel-bypass]
project: cnj-info-extractor
---

# Session: import-fix, neon-migration, qstash-region, vercel-bypass

## Context
Follow-up to `docs/session-entra-neon-qstash-xlsx-tpu.md`. The P0 triage feature was committed at `dec70de` with 46/46 tests green, but was not operable: three handlers imported one directory level too high, so Entra login and the retention purge failed at runtime while CI stayed green. This session fixed the blockers, closed the feature gaps the README already promised, covered the untested modules, and brought the Preview environment up end to end — Neon migrated, QStash wired, SSO login homologated by the user.

Branch `feature/p0-triagem`, worktree `.worktrees/p0-triagem`. Eight commits, pushed to `origin`. `main` still has none of this.

## Decisions
- **Replace `node --check` with real import resolution** — the old `npm run check` was a hand-maintained chain of syntax checks; it cannot catch a wrong specifier, which is exactly how the three broken handlers reached production green.
- **Keep the offline decoder public under SSO** — the load-time redirect sent every visitor to Microsoft, contradicting `index.html` and the README. The Entra hop now happens only on actions that need identity.
- **Format of an uploaded spreadsheet comes from `Content-Type`, never the file name** — a client-supplied name must not select a server-side parser.
- **Vercel protection bypass travels as a header, not a query parameter** — `verifyQstash` signs `APP_BASE_URL + req.url`; an extra query parameter would invalidate the QStash signature.
- **QStash stays the only path to the purge; no Vercel Cron** — the endpoint verifies a QStash signature and would reject a cron call with 401. Documented the schedule command instead of adding a `crons` block.
- **Preview only for now** — Neon was provisioned in the Preview scope; production is untouched by explicit choice.

## Solutions & Findings

### Blocker 1 — broken imports (silent in CI)
- `api/auth/login.js:1`, `api/auth/callback.js:1`, `api/maintenance/purge.js:1-2` resolved `../../../server/*`, one level above the repository root → `ERR_MODULE_NOT_FOUND`. Correct depth reference: `api/batches/index.js:1-6`.
- Confirmed by importing all 22 modules under `api/` and `server/`; only those three failed.
- `scripts/check-imports.mjs` now backs `npm run check`: imports every module under `api/`, `server/`, `scripts/`, falls back to `node --check` for the classic IIFE scripts in `js/` and for `scripts/migrate.js` (which opens a Neon connection at module top level).
- `.github/workflows/test.yml` had no `npm ci`, so the three runtime dependencies were absent in CI.

### Blocker 2 — `createBatch` broken against the real driver
- `server/db.js:83` built its transaction with `tx("INSERT ...", [params])`. The v1 Neon driver only accepts that form as a tagged template: `This function can now be called only as a tagged-template function`. Every `POST /api/batches` and every import would have returned `503 lote_indisponivel`.
- Fixed to `tx.query(...)`. Found only by running the persistence layer against the real database — the handler tests mocked `createBatch` itself, and the db fake exposed a permissive `.query` on everything. The fake now mirrors the driver's rule.

### Blocker 3 — QStash region
- The account lives in `us-east-1`; the SDK default `https://qstash.upstash.io` answers `404 user not found in this region`.
- The SDK resolves `config.baseUrl ?? QSTASH_URL ?? DEFAULT` (`node_modules/@upstash/qstash/chunk-JYPXGFWX.mjs:1067`), so setting `QSTASH_URL` is enough — no code change. Same regional endpoint applies to the API calls that create schedules.

### Blocker 4 — Vercel Deployment Protection
- Every path on the preview, `/api/*` included, answered 302 to `vercel.com/sso-api`, which killed the Entra callback and every QStash job.
- `server/queue.js` now forwards `x-vercel-protection-bypass` from `VERCEL_AUTOMATION_BYPASS_SECRET` (injected by Vercel) in `publishJSON`; absent secret sends no header, so unprotected deployments are unaffected.
- The purge schedule carries it as `Upstash-Forward-x-vercel-protection-bypass`.
- A browser needs one visit to `<APP_BASE_URL>/?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true` before the Entra callback can complete.

### Feature gaps closed
- `server/csv.js` — server-side CSV reader (quoted fields, `,` or `;` detected from the header, CRLF, BOM, 2 MiB cap). `api/batches/import.js:26` routes by `Content-Type`; CSV was previously read in the browser and dumped into the textarea.
- `server/p0-core.js:19` classification was persisted and exported but invisible in the UI. Now rendered in the single lookup (stage, code, date, age) and as a per-row batch table built with `createElement`/`textContent`.
- `api/batches/index.js:32` — `GET /api/batches?id=` returns the per-row items it already joined.
- `api/batches/index.js:23` — 401 now carries `login: "sso"`, matching its sibling routes.
- `server/sso.js:26` — allowed e-mail domain reads `SSO_EMAIL_DOMINIO`, default `btblue.com.br`.
- `js/app.js:198` — batch and spreadsheet error codes mapped to Portuguese; they all fell through to a generic message.

### Verification against the real Preview stack
- Migration applied: 8 tables (`users`, `sessions`, `processes`, `snapshots`, `movements`, `consultation_events`, `batches`, `batch_items`), 3 indexes.
- SQL round trip: `upsertUser`, `persistSnapshot` (code 12548 → `expedicao_alvara`, 24 h TTL), `freshSnapshot`, `createBatch`, `claimBatchItem` (tentativas=1, correct `user_id`), `finishBatchItem` roll-up (`concluido`, `{concluido:1, invalido:1}`), the `estagio` join in `batchItemsForUser`, and per-user isolation (`null` for another `user_id`). Test rows deleted; all counters back to 0.
- `/api/session` returns `{"error":"autenticacao_necessaria","login":"sso"}` → `ssoConfigurado()` is true on Preview.
- `/api/auth/login` issues the Entra authorize URL with PKCE S256 and `redirect_uri=<alias>/api/auth/callback` — the live proof the import fix works.
- QStash test delivery to `/api/maintenance/purge`: `DELIVERED`, `responseStatus 204`.
- **Login through Entra homologated by the user.**
- Suite: 119 tests passing, `npm run check` 28 files clean.

## Commands & Config

```
npm test          # node --experimental-test-module-mocks --test tests/node/*.test.js
npm run check     # node scripts/check-imports.mjs
npm run db:migrate

# Migration (Preview). Vercel env pull is useless here: every value comes back
# empty because the project's variables are sensitive.
DATABASE_URL='<neon connection string>' npm run db:migrate

# Preview environment (all set)
M365_TENANT_ID / M365_CLIENT_ID / M365_CLIENT_SECRET
SESSION_SECRET  DATABASE_URL  DATAJUD_API_KEY  UPSTASH_REDIS_KV_*
QSTASH_TOKEN  QSTASH_CURRENT_SIGNING_KEY  QSTASH_NEXT_SIGNING_KEY
QSTASH_URL=https://qstash-us-east-1.upstash.io
APP_BASE_URL=https://cnj-info-extractor-git-feature-0b0bb2-bt-blue-ativos-judiciais.vercel.app
SSO_EMAIL_DOMINIO   # optional, defaults to btblue.com.br

# Purge schedule (created): scd_4rQaTa2JyMM9peSDuPvW1fwjZH8M, cron 0 4 * * *
curl -X POST "https://qstash-us-east-1.upstash.io/v2/schedules/$APP_BASE_URL/api/maintenance/purge" \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: 0 4 * * *" \
  -H "Upstash-Forward-x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"

# Entra redirect URI (registered)
https://cnj-info-extractor-git-feature-0b0bb2-bt-blue-ativos-judiciais.vercel.app/api/auth/callback
```

## Files Changed

Commits, oldest first:

- `a22dd79` — `api/auth/login.js`, `api/auth/callback.js`, `api/maintenance/purge.js` import depth; `scripts/check-imports.mjs`; `package.json` check script; `.github/workflows/test.yml` gains `npm ci` + npm cache; `api/batches/index.js` 401 hint; README purge schedule.
- `40f4693` — `js/app.js` drops the load-time SSO redirect; `tests/node/app-flow.test.js` inverted to assert no redirect.
- `378e896` — `server/csv.js` (new); `api/batches/import.js` content-type routing; `js/api.js` `importarCsv`; `js/app.js` stage rendering, batch table, error map; `index.html` `#batch-itens`; `styles.css`; `server/sso-config.js` `dominioPermitido()`; `server/sso.js`; `.env.example`.
- `b4be765` — new tests: `module-resolution`, `sso`, `queue`, `batch-worker`, `batches-api`, `batches-import`, `db`, `csv`, `purge`, `auth-handlers`; `package.json` test flag.
- `1868f3a` — README structure, env table, `/api/session` contract; session note; `server/p0-core.js` comment on the unreachable `penhora`/`execucao` TTLs; removes `docs/session-context.md`.
- `72a6d19` — `server/db.js:83` `tx.query`; `tests/node/db.test.js` fake mirrors the driver rule + `createBatch` tests.
- `726442e` — `server/queue.js` bypass header; `tests/node/queue.test.js`; README bypass notes.
- `ac85338` — `QSTASH_URL` documented in README and `.env.example`.

## Blockers & Open Questions
- **Credentials exposed in the conversation, all still live**: the Entra client secret (from the previous session), the Neon password `npg_dVvQ…`, the three QStash keys, and the Vercel bypass secret `wyG951…`. The bypass secret is the most sensitive — it disables Deployment Protection entirely. All are Preview-scoped; rotate before this reaches production.
- Production has only `M365_*`, `SESSION_SECRET`, `DATAJUD_API_KEY` and Upstash Redis — no `DATABASE_URL`, so it silently runs the legacy shared-password mode. A production Neon database does not exist yet.
- The purge schedule points at the branch alias. Renaming or deleting `feature/p0-triagem` leaves it hitting a dead URL, accumulating failures with no alert.
- TPU map still holds a single curated code (`12548`); `penhora` and `execucao` have TTLs but nothing maps to them. Needs legal review.
- MSAL adds `offline_access` to the scope; the refresh token is never used, since the session is an opaque 8 h cookie in Neon. Harmless but broader than needed.
- `db/migrations/` has no version ledger — the single migration is idempotent via `IF NOT EXISTS`, but a second migration will need one. `scripts/migrate.js:8` splits on `;`, which breaks on any future function or `DO` block.
- `main` has never received this work; it sits behind both `feature/datajud-security-hardening` and `feature/p0-triagem`.

## Next Steps
1. Run one CSV batch and one XLSX batch through the Preview UI with the real SSO session, and confirm the per-row table shows `estagio` and that both exports download.
2. Watch the first scheduled purge (04:00 UTC) in the QStash console; a `DELIVERED / 204` there closes Preview homologation.
3. Rotate the four exposed credentials: Entra client secret, Neon password (Settings → Reset password; the Vercel integration updates the variable), the QStash signing keys, and the Vercel bypass secret.
4. Decide whether `feature/p0-triagem` merges into `main` or goes through a PR, and get `main` caught up — it is missing the security hardening too.
5. For production: provision a separate Neon database (do not share the Preview one — 180-day retention would mix test and real data), set `DATABASE_URL`, `APP_BASE_URL`, and the QStash variables including `QSTASH_URL`, register the production redirect URI in Entra, and create a second purge schedule pointed at the production domain before deleting `scd_4rQaTa2JyMM9peSDuPvW1fwjZH8M`.
6. Add TPU codes beyond `12548` once legal approves, bumping `VERSAO_TPU` in `server/p0-core.js:1`.
