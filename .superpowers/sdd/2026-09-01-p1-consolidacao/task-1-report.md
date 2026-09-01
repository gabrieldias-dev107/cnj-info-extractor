# Task 1 - P1 pure domain modules and schema

## Scope delivered

- Added `CNJ.sugerirCorrecoes(numero)`, which returns unique, DV-valid candidates for one-digit substitutions and adjacent transpositions without modifying the supplied value.
- Added a versioned, legally curated TPU catalog containing only code `12548` for `expedicao_alvara`.
- Added pure glossary lookup and relevant-stage transition logic. A transition alerts only when its stages differ and one is an approved catalog stage.
- Added the additive P1 migration for portfolios, memberships, monitored processes, health probes and measurements, pending alerts, and alert send attempts. Every retained P1 table has an `expires_at` index for the existing 180-day purge policy.

## Files changed

- `js/cnj.js` - candidate-only correction function and public export.
- `tests/node/cnj.test.js` - real-browser-module coverage for one-digit and adjacent-transposition candidates, validity, uniqueness, and input immutability.
- `server/tpu-catalog.js` - immutable approved TPU seed and safe metadata lookup.
- `server/p1-core.js` - pure glossary and relevant-transition functions.
- `tests/node/p1-core.test.js` - uncurated lookup, approved transition, and unknown-to-unknown non-alert coverage.
- `db/migrations/0003-p1-consolidacao.sql` - additive P1 relational schema and expiry indexes.

## TDD evidence

RED command: `node --test tests/node/cnj.test.js tests/node/p1-core.test.js`.

Observed RED result: exit code `1`; the new correction test failed with `cnj.sugerirCorrecoes is not a function`, and the new domain test failed with `ERR_MODULE_NOT_FOUND` for `server/p1-core.js`. These failures identified the intentionally absent APIs.

GREEN command: `node --test tests/node/cnj.test.js tests/node/p1-core.test.js`.

Observed GREEN result: exit code `0`; `7` tests passed and `0` failed.

Final verification commands: `npm test`; `npm run check`; `git diff --check`.

Observed results: `npm test` exit code `0` with `139` passing and `0` failing; import check reported `OK: 30 arquivos verificados, 0 com erro`; `git diff --check` exit code `0` with no whitespace errors.

## Commit

`feat: add P1 domain foundation`.

## Concerns and follow-up

- The migration was not applied to Neon: applying migrations is an external deployment operation and remains for the P1 rollout.
- A malformed CNJ can have more than one mathematically valid candidate (for example, changing its DV versus correcting another digit). The function deliberately returns candidates only; the Task 4 UI must leave selection explicit with the user.
- Task 3 must extend the existing signed purge path to remove these P1 records after their 180-day expiry; this task supplies only the indexed schema foundation.
