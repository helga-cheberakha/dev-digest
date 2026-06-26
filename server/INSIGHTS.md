# Insights — server

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-06-25** — Smart Diff (`GET /pulls/:id/smart-diff`) is purely deterministic — zero LLM calls. `classifier.ts` runs RegExp patterns from `constants.ts` to assign `core|wiring|boilerplate`; `service.ts` fetches `prFiles` + the single most-recent `reviews` row (latest by `createdAt desc limit 1`) and joins its `findings` by `reviewId`. Pattern constants and `TOO_BIG_THRESHOLD` live in `constants.ts` so tuning never touches logic files. Evidence: `server/src/modules/smart-diff/`.

- **2026-06-18** — `POST /skills/import` must be registered BEFORE `GET /skills/:id` in Fastify routes, otherwise Fastify matches the literal segment `import` as a UUID param and returns 422. Fixed by registering the static path first. Evidence: `server/src/modules/skills/routes.ts:60`.
- **2026-06-18** — Skills wiring in reviews: `run-executor.ts` fetches `agentsRepo.linkedSkills(agent.id)`, filters to `.skill.enabled`, and passes the bodies as `{ skills: skillBodies }` to `reviewPullRequest()`. `assemblePrompt` in reviewer-core renders `## Skills / rules` automatically when the array is non-empty — no reviewer-core changes needed. Evidence: `server/src/modules/reviews/run-executor.ts`.

- **2026-06-14** — Shared contracts (`@devdigest/shared`) are vendored as TWO hand-maintained copies — `server/src/vendor/shared/` and `client/src/vendor/shared/` — resolved by tsconfig path alias, NOT auto-synced. Adding a field means editing both in lock-step; the only diffs between copies are comments. Evidence: `server/src/vendor/shared/contracts/trace.ts`, `platform.ts`.
- **2026-06-14** — PR-list per-PR aggregates (score, cost) are computed ON READ in `GET /repos/:id/pulls` via one `inArray` query + JS grouping, never denormalized onto `pull_requests`. "Latest review batch" cost has no batch id in the schema — approximated by summing `agent_runs.cost_usd` within a 120s window of the PR's newest priced run. Evidence: `server/src/modules/pulls/routes.ts`.
- **2026-06-14** — `completeAgentRun`'s `values` shape is declared in TWO places that must match: the repo fn (`repository/run.repo.ts`) AND the interface wrapper (`repository.ts:151`). Adding a field (e.g. `costUsd`) needs both or typecheck fails.
- **2026-06-17** — PR-list `GET /repos/:id/pulls` returns the latest batch's FINDINGS as full `Finding[]` records (not counts) under `PrMeta.findings`, mapped via `reviews/helpers.ts#findingRowToDto`; the client derives severity chips AND renders a hover popover from that one array (no second fetch, perfect chip↔popover consistency). The "latest review batch" here is a SEPARATE window from the cost block: cost windows over `agent_runs.ranAt`, findings windows over `reviews.createdAt` (both 120s). A pre-existing `rollupSeverities` helper in `modules/pulls/status.ts` (lowercase keys) was built for a counts-only variant — currently unused by the route. Evidence: `server/src/modules/pulls/routes.ts`.

## Tool & Library Notes

- **2026-06-14** — New DB columns: edit `db/schema/*.ts`, then `npm run db:generate` (drizzle-kit) auto-generates `00NN_*.sql` (e.g. `0010_solid_baron_zemo.sql` = `ALTER TABLE … ADD COLUMN`). Never hand-write migration SQL; apply with `npm run db:migrate`.
- **2026-06-25** — **Supersedes above for column renames:** `drizzle-kit generate` opens an interactive TTY prompt when it detects a possible column rename — piping input doesn't work in non-TTY environments. For renames, write the migration SQL manually (use `ALTER TABLE … RENAME COLUMN old TO new`) and add a matching entry to `meta/_journal.json` with the next `idx`. Evidence: `server/src/db/migrations/0014_intent_layer.sql`, `server/src/db/migrations/meta/_journal.json`.

## Recurring Errors & Fixes

- **2026-06-14** — Adding a required field to a Zod contract (`RunStats.cost_usd`) breaks the inline fixture in `server/test/contracts.test.ts` (RunTrace parse). Update the `stats: {…}` fixture in the same change. Evidence: `server/test/contracts.test.ts:160`.
- **2026-06-25** — `reviews/repository/pull.repo.ts` contains hidden `upsertIntent`/`getIntent` helpers that mirror the `Intent` contract shape. When `Intent` fields are renamed (e.g. `intent` → `summary`), this file must be updated alongside the contract — it's easy to miss because it lives inside the `reviews` module, not in `modules/intent/`. Evidence: `server/src/modules/reviews/repository/pull.repo.ts:49-68`.

## Session Notes

### 2026-06-25 (Smart Diff)
- Built Smart Diff (L03): `modules/smart-diff/` (constants, classifier, service, routes), `GET /pulls/:id/smart-diff` registered in `modules/index.ts`. No DB migration needed — reads from existing `prFiles` and `findings` tables. Zero LLM calls.

### 2026-06-25
- Built Intent Layer (L03) end-to-end: DB schema migration 0014 (renamed `intent`→`summary`, added `risk_areas`/`model`/`tokens_saved`/timestamps to `pr_intent`), `modules/intent/` module (routes/service/repository), `resolveFeatureModel(…, 'review_intent')` for cheap model, token-savings logging, `container.intentRepo` getter, `run-executor` wired to fetch intent + pass to `reviewPullRequest`.
- Decision: no `workspaceId` on `pr_intent` (follows `pr_brief` precedent — scoping via PR uuid FK is sufficient; workspace guard at route level).
- Updated `reviews/repository/pull.repo.ts` intent helpers to new contract shape.

### 2026-06-18
- Built Skills feature (L02) end-to-end: server module (`modules/skills/` — routes/service/repository/helpers), schema migration 0011 (`message` column on `skill_versions`), `SkillVersion`/`SkillStats`/`SkillImportPreview` contracts (lock-step in both vendor copies), `fflate` for ZIP preview, skills wiring in `run-executor.ts`, seed catalog (8 skills + Test Quality Reviewer agent).
- Decision: `POST /skills/import` registered before `/:id` route to prevent Fastify matching "import" as a UUID param.

### 2026-06-14
- Re-introduced per-run cost (USD) end-to-end (lesson reversing the earlier removal in `d45ab0d`/`58c6ac7`): `cost_usd` column on `agent_runs` (migration 0010), captured in `run-executor` (was discarding `outcome.costUsd`), surfaced in `RunSummary`/`RunStats`/`PrMeta`.
- Decision: PR-list COST = sum of the latest review batch via a 120s window heuristic (no batch id in schema). Cost persisted (accurate `outcome.costUsd`), not recomputed; historical runs → null → "—".

## Open Questions

- **2026-06-14** — PR-list "latest review batch" uses a 120s `ranAt` window as a proxy for a review session. If a real review-session / batch id is ever added to the schema, swap the window for exact grouping in `pulls/routes.ts`.
