# DataJud Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the existing DataJud hardening with free production authentication, reproducible tests, CI, and a verified Vercel Preview.

**Architecture:** Keep the static decoder public and dependency-free in the browser. Protect only online DataJud access with a stateless HMAC cookie and an Upstash-backed login limiter; keep server-only modules outside `api/`. Validate authentication before cache use or DataJud traffic.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node.js 22 built-ins, Vercel Functions, Upstash Redis REST, GitHub Actions.

**Spec:** `docs/session-datajud-proxy,rate-limit,xss-hardening.md` plus the approved plan in the implementing session.

## Global Constraints

- Prefer free services; add no runtime or development dependencies.
- Keep offline CNJ decoding public and functional under `file://`.
- Protect only online lookup and browser cache; shared password has no per-user audit.
- Session duration is 28,800 seconds.
- `APP_ACCESS_PASSWORD` requires at least 16 characters; `SESSION_SECRET` requires at least 32 characters.
- Never log credentials, cookies, full IP addresses, or full process numbers.
- Preserve CSP without `unsafe-inline` and render external data only through DOM text nodes.
- Keep `.serena/`, `.vercel/`, local env files, and secrets out of commits.

---

### Task 1: Reproducible baseline and server characterization

**Files:**
- Create: `package.json`
- Create: `tests/node/cnj.test.js`
- Create: `tests/node/datajud.test.js`
- Create: `tests/node/ratelimit.test.js`
- Create: `tests/node/helpers/http.js`
- Modify: existing server modules only where exports or dependency injection are required for testing

**Interfaces:**
- `npm test` runs all Node tests without third-party packages.
- `npm run check` syntax-checks production JavaScript.

- [ ] Write Node tests characterizing CNJ logic, DataJud contract, ordering, error taxonomy, redacted logs, origin checks, rate-limit windows, and fail-open behavior.
- [ ] Run tests and capture expected failures caused only by missing test seams or package configuration.
- [ ] Add minimal package/test seams.
- [ ] Run `npm test`, `npm run check`, and legacy browser tests.
- [ ] Commit as `test: add reproducible security baseline`.

### Task 2: Shared-password session and protected proxy

**Files:**
- Create: `server/auth.js`
- Create: `server/origin.js`
- Create: `server/rate-limit.js`
- Create: `api/session.js`
- Modify: `api/datajud.js`
- Remove: `api/_ratelimit.js`
- Test: `tests/node/auth.test.js`, `tests/node/session.test.js`, existing server tests

**Interfaces:**
- `GET /api/session` returns 204 or `401 autenticacao_necessaria`.
- `POST /api/session` consumes `{ senha }`, returns 204 with `cnj_session`, or documented JSON errors.
- `DELETE /api/session` expires `cnj_session` and returns 204.
- `/api/datajud` returns `401 autenticacao_necessaria` before Redis/DataJud access without a valid session.

- [ ] Write failing tests for HMAC tokens, cookie attributes, expiry/tampering, configuration validation, session endpoint methods, login limit, logout, hashed client keys, and protected DataJud ordering.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement stateless 8-hour sessions using Node crypto and constant-time password comparison.
- [ ] Implement origin helper, login limiter at 10 attempts/IP/15 minutes, and hashed rate-limit identifiers.
- [ ] Keep login fail-closed on Redis failure; keep authenticated DataJud rate limiting fail-open.
- [ ] Change default global daily DataJud limit to 2,000.
- [ ] Run focused and full tests.
- [ ] Commit as `feat: protect DataJud lookup with shared session`.

### Task 3: Accessible login dialog and protected cache

**Files:**
- Modify: `index.html`
- Modify: `js/api.js`
- Modify: `js/app.js`
- Modify: `styles.css`
- Test: `tests/node/client.test.js`

**Interfaces:**
- `CNJApi` exposes session check, login, logout, protected lookup, and cache clearing.
- Login dialog uses native `<dialog>` and retries the pending lookup after successful login.

- [ ] Write failing client tests for session-before-cache, login/logout requests, cache clearing, retry behavior, and XSS-safe rendering.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add native dialog with focus return, Escape/cancel, alert errors, loading state, and 44px controls.
- [ ] Add logout control that clears session, cached DataJud data, and current online result.
- [ ] Preserve CSP and Flat UI tokens; add no inline script/style.
- [ ] Run focused and full tests.
- [ ] Commit as `feat: add accessible DataJud login flow`.

### Task 4: CI, documentation, and delivery verification

**Files:**
- Create: `.github/workflows/test.yml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/session-datajud-proxy,rate-limit,xss-hardening.md`
- Modify: `.gitignore` only to remove duplication; leave `.serena/` untracked

**Interfaces:**
- GitHub Actions uses Node 22 and runs `npm test` plus `npm run check` with `contents: read`.

- [ ] Add dependency-free CI workflow.
- [ ] Document shared-password limits, all env vars, 8-hour session, free-tier budget, errors, rotation, login/logout, and accurate Vercel Hobby protection scope.
- [ ] Run `npm test`, `npm run check`, legacy tests, and `git diff --check` fresh.
- [ ] Verify locally with `vercel dev` when credentials are available; test 401, 403, 429, successful DataJud response, logout, headers, desktop/mobile dialog, keyboard focus, and XSS payload.
- [ ] Commit as `ci: verify DataJud security hardening`.
- [ ] Authenticate external CLIs as needed, push the branch, wait for CI, and publish/verify Preview without committing secrets.
