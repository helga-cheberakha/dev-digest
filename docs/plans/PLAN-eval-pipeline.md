# Implementation Plan: Eval Pipeline for reviewer agents (Lesson 06)

## Overview
Turn reviewers' accept/dismiss decisions into stored eval cases (via a prefilled, reviewable
create flow — never a silent insert) and let an agent be re-run against its whole set, producing
deterministic recall / precision / citation metrics so prompt changes become measurable. Ships an
Evals tab in the Agent editor, a workspace Eval Dashboard at `/eval`, a two-run compare + promote
flow, and a `verify:l06` gate proving the scorer is offline and LLM-free. `eval_cases` is untouched;
`eval_runs` gains two additive nullable columns (`batch_id`, `agent_version`) via a small migration
(T1) — no other schema change.

## Execution mode
multi-agent (parallel) — cross-module feature (server + reviewer-core consumption + client)
with a clean contracts-first DAG and non-overlapping owned paths. **Assumed default — could not
run the question round (AskUserQuestion is unavailable to subagents); confirm before dispatch.**

## Requirements (verified)
- Source: `specs/SPEC-2026-07-10-eval-pipeline.md` (approved) — ACs: AC-1..AC-25 (AC-25 added
  2026-07-10: regression-flip alert, priority over the AC-17 floor-warning).
- All three prior open questions are resolved inline in the spec and are treated as settled:
  Promote vN = client-side compose of existing `GET /agents/:id/versions/:version` + `PUT
  /agents/:id` (no new endpoint); add net-new `EvalRunBatch` + `EvalCompare` contracts lockstep;
  precision noise rule = any actual finding matching no expected region is noise.
- Three further decisions made 2026-07-10 (post-plan, folded into this revision): aggregation is
  **pooled**, not macro-average; `EvalDashboard.alert` carries **both** a regression-flip signal
  (AC-25, priority) and the ≥8-case floor-warning (AC-17, fallback); a case-from-finding is a
  **prefill-then-Save** flow (AC-1-4 rewritten) via a shared `EvalCaseModal`, never a silent atomic
  insert; and a batch is identified by an **explicit `batch_id` column** (+ `agent_version` column)
  added via a small additive migration, not the `ran_at`-proxy originally assumed — see item 4 below,
  now superseded.

### Drift found against the spec's claims (verified against live code, corrected in this plan)
1. **`activeKeyFor` already maps `/eval` → `"eval"` — CONFIRMED TRUE.** `client/src/components/
   app-shell/helpers.ts:35` (`if (pathname.startsWith("/eval")) return "eval";`). The sidebar
   task therefore edits **only** `vendor/ui/nav.ts` — no `helpers.ts` edit (spec said "register in
   both"; the second is already done).
2. **Vendor contracts live under a `contracts/` subdir**, not a flat file. The frozen `Eval*`
   contracts are in `server|client/src/vendor/shared/contracts/knowledge.ts` and `…/eval-ci.ts`,
   re-exported by `…/vendor/shared/index.ts`. Net-new `EvalRunBatch`/`EvalCompare` + the payload
   schemas are **additive exports appended to `contracts/eval-ci.ts`** in both mirrors (its own
   header says "these EXTEND the barrel") — no existing symbol changes, no `index.ts` edit needed
   (already `export *`s eval-ci).
3. **i18n messages are per-namespace files auto-loaded by `readdirSync`** (`client/src/i18n/
   request.ts`). `messages/en/eval.json` and `messages/en/agents.json` already exist. Each UI task
   owns a distinct namespace file → no message-file contention (see owned paths). This is the
   "new file discovered by a glob/registry" case: the discoverer is `loadMessages` in
   `request.ts` — new namespace files are picked up with zero wiring.
4. **`eval_cases` / `eval_runs` are already migrated** in `server/src/db/migrations/0000_init.sql`
   with `input_meta` / `expected_output` / `actual_output` as `jsonb` and `input_files` as `jsonb`.
   Confirmed the `jsonb` columns are `z.unknown()` in the frozen `EvalCase` contract — payload
   shapes are ours to define. **Superseded 2026-07-10:** the "no migration" conclusion held only for
   `eval_cases`; `eval_runs` now gets one additive migration (T1) for the explicit `batch_id`/
   `agent_version` columns (decided over the `ran_at`-proxy this drift note originally assumed).
   Verified separately: nothing currently writes to either table in this repo (no seed script, no
   route/service exists yet) — the new columns need no backfill.
5. **`reviewPullRequest` signature confirmed** (`reviewer-core/src/review/run.ts`): returns
   `ReviewOutcome { review (grounded findings that survived), grounding: string, dropped: [], … }`.
   `citation_accuracy = kept ÷ produced` is derivable as `review.findings.length ÷
   (review.findings.length + dropped.length)` — the run path (T4) surfaces `{kept, produced}` so
   the pure scorer (T3) needs no grounding I/O.
6. **`verify:l03` confirmed** at `server/package.json:14`
   (`"verify:l03": "vitest run src/modules/smart-diff/classifier.test.ts"`). `verify:l06` mirrors it.

## Open questions & recommendations
- Q (blocking, defaulted): **Run execution model** — synchronous sequential vs async queued+SSE?
  → default: **synchronous sequential** (`POST /agents/:id/eval-runs` awaits a concurrency-bounded,
  effectively sequential loop over cases and returns the aggregate `EvalRun` directly). AC-6's
  observable ("after a run … the response aggregate's traces_total = N") and AC-24 (isolate + keep
  prior results) are satisfied without runBus/SSE/`agent_runs` infra. The spec's "reuse the queued-
  run mechanism" is a soft perf note; a sequential await loop opens one provider connection at a
  time and is the minimal correct shape. **Confirm** — choosing async queued+SSE materially adds
  bus wiring, an active-runs endpoint, and client polling (would reshape T5 + add a client task).
- Q (defaulted): **AC-17 seed location** → default: new `server/src/db/seed-eval.ts` invoked from
  the existing `server/src/db/seed.ts` (keeps `seed.ts` lean; mirrors the existing multi-file seed
  split with `seed-prompts.ts`). Confirm vs inlining into `seed.ts`.
- Q (defaulted): **Execution mode** → multi-agent (see above).
- Rec: keep the deterministic scorer (T3) a **pure module with no import of `reviewer-core` or the
  DB** — it takes plain `{actual regions, expected/forbidden regions, kept, produced}` inputs. This
  is what makes `verify:l06` trivially offline (AC-12/AC-19) and lets T3 land before the run path.
- Rec: store the `expectation` discriminator **explicitly** inside `expected_output` (per the
  spec's Assumptions) and `safeParse` the whole payload on write (AC-22) — do not infer from an
  empty-vs-non-empty regions array.
- Rec (out of scope — do not build): the spec's three PROPOSALs (dedupe by `source_finding_id`,
  diff-drift indicator, skill-owner evals) stay out; noted here only so they are not silently
  folded in.

## Affected modules & contracts
- **server** — new `modules/eval/` (repository, scoring, run path, service, analytics, routes),
  one-line registration in `modules/index.ts`, one repo getter + override field in
  `platform/container.ts`, `verify:l06` in `package.json`, `db/seed-eval.ts` + a call from
  `db/seed.ts`. **Additive migration:** `eval_runs` gains two nullable columns (`batch_id`,
  `agent_version`) + an index; `eval_cases` untouched (see T1).
- **reviewer-core** — unchanged; consumed via existing public exports (`reviewPullRequest`,
  `assemblePrompt`/`wrapUntrusted` internally, grounding via `ReviewOutcome`).
- **client** — `lib/api.ts` eval client + query keys; a shared `EvalCaseModal` (prefill-then-Save,
  also used for manual create + editing); "Turn into eval case" on `FindingCard` (+ `FindingsPanel`
  wiring) opening that modal; an Evals tab in the Agent editor reusing the same modal; an `/eval`
  dashboard page + sidebar item.
- **Contracts (net-new, additive, lockstep in BOTH `server/src/vendor/shared/contracts/eval-ci.ts`
  and `client/src/vendor/shared/contracts/eval-ci.ts`):**
  - `EvalExpectedOutput` = `{ expectation: 'must_find'|'must_not_flag', regions: EvalRegion[] }`,
    `EvalRegion` = `{ file, start_line, end_line, severity?, category? }` (payload for the
    `expected_output` jsonb).
  - `EvalInputMeta` = `{ source_finding_id: string, pr_number?: int }` (payload for `input_meta`).
  - `EvalActualOutput` = `{ findings: FindingLite[], grounding: {kept:int, produced:int},
    error?: string }` (payload for `actual_output` — **no `agent_version`**, it's a real
    `EvalRunRecord`/`eval_runs` column now, not duplicated in jsonb).
  - `EvalCaseFromFinding` = `{ finding_id: string }` (draft-from-finding request body).
  - `EvalRunBatch` = `{ batch_id, ran_at, agent_version, recall, precision, citation_accuracy,
    traces_passed, traces_total }`.
  - `EvalCompare` = `{ a: EvalRunBatch, b: EvalRunBatch, prompt_diff: {...}, delta: {recall,
    precision, citation_accuracy} }`.
  - `EvalRunRecord` gains two top-level fields: `batch_id: string | null`, `agent_version: number |
    null` (mirrors the new `eval_runs` columns).
  - **Callout:** these are purely additive — no existing frozen `Eval*` symbol is edited; `Severity`
    / `FindingCategory` are reused from `contracts/findings.ts`; `FindingLite` reuses/narrows the
    existing `Finding` shape.

## Architecture changes
- **New module `server/src/modules/eval/`** (onion-compliant, mirrors `blast`/`reviews`):
  - `repository.ts` — Infrastructure. ONLY layer touching `db/schema` for eval; workspace-scoped
    reads/writes over `eval_cases` × `eval_runs`; batch grouping by the `batch_id` column. Returns
    domain rows.
  - `scoring.ts` — pure Core-style unit (no I/O, no `reviewer-core`, no DB import). Deterministic
    match rule + recall/precision/citation math.
  - `run.ts` — Application composition (mirrors `mcp-server/src/cli/review.ts`): builds a synthetic
    `UnifiedDiff` from `case.input_diff` via `parseUnifiedDiff`, resolves `container.llm(provider)`
    + linked skill bodies, calls `reviewPullRequest` directly (NO repo-intel/callers/repoMap/context
    — AC-7), returns `{ findings, kept, produced }`. Never imports an SDK directly.
  - `service.ts` — Application. create-from-finding, list, run-batch orchestration (reads finding
    via `container.reviewRepo`, agent + skills via `container.agentsRepo`, calls `run` + `scoring`,
    persists via `evalRepo`). Depends on interfaces via `container`, never a concrete adapter.
  - `analytics.ts` — Application. history batches, compare (deltas + `system_prompt` diff via
    `agentsRepo.getVersion`), dashboard aggregate.
  - `routes.ts` — Transport. Zod-validated params/body/response → service; no logic/DB/SDK.
- **`platform/container.ts`** — add `get evalRepo(): EvalRepository` lazy getter + `evalRepo?`
  field on `ContainerOverrides` (test injection), mirroring `blastRepo`
  (`container.ts:79,108-110`).
- **`modules/index.ts`** — one import + one registry entry `eval` (the file's documented
  "ADD A MODULE" step).
- **client** — `/eval` is an RSC page under `app/eval/page.tsx`; interactive pieces (Evals tab,
  compare, dashboard cards) are `"use client"` and fetch through `lib/api.ts` + TanStack Query.
  Type contracts come only from `@devdigest/shared` — no hand-duplication.

## Phased tasks
<!-- The orchestrator spawns `implementer-backend` for backend/core tasks, `implementer-ui`
     for ui tasks. Concurrency: within a phase, tasks with disjoint Owned paths run in parallel. -->

### Phase 1 — Schema migration + contracts (root of the DAG)
- **T1 — `eval_runs` migration + net-new eval contracts + payload schemas (lockstep, both mirrors)**
  - **Action:**
    1. **Migration (decided, explicit columns over a `ran_at`-proxy):** edit
       `server/src/db/schema/eval.ts` — add `batchId: uuid('batch_id')` (nullable) and
       `agentVersion: integer('agent_version')` (nullable) to `evalRuns`; add
       `index('eval_runs_batch_id_idx').on(t.batchId)`. Do **not** touch `evalCases`. Run
       `pnpm db:generate` (pure addition — no rename, no interactive TTY prompt) then
       `pnpm db:migrate`, and review the generated `0018_*.sql`. **Existing-data check (verified,
       re-verify at implementation time):** nothing currently writes to `eval_cases`/`eval_runs` in
       this repo — no seed script, no route/service exists yet — so there is no legacy data to
       backfill; the columns stay nullable defensively (this feature's own write path always sets
       both; a future orphan row is excluded from batch views rather than blocking the migration).
    2. Append to `server/src/vendor/shared/contracts/eval-ci.ts`: extend `EvalRunRecord` with
       `batch_id: z.string().nullable()` and `agent_version: z.number().int().nullable()`. Add
       `EvalRegion`, `EvalExpectedOutput` (with the explicit `expectation` discriminator),
       `EvalInputMeta`, `EvalActualOutput` (with `FindingLite` — **no `agent_version` field**, it's
       now a real `eval_runs`/`EvalRunRecord` column, not duplicated in the jsonb payload),
       `EvalCaseFromFinding`, `EvalRunBatch`, `EvalCompare` — reusing `Severity`/`FindingCategory`/
       `Finding` imported from `./findings.js` and `EvalRun` from `./knowledge.js`. Export both the
       Zod schema and the `z.infer` type for each (project convention `type-export-schemas-and-types`).
    3. Mirror the exact same additions **byte-for-byte** into
       `client/src/vendor/shared/contracts/eval-ci.ts` (hand-maintained, no auto-sync).
    4. Do NOT touch `index.ts` in either mirror — `export * from './contracts/eval-ci.js'` already
       re-exports the file (verified `server/src/vendor/shared/index.ts:24`).
  - **Module:** server + client (shared vendor)
  - **Type:** core
  - **Skills to use:** zod, typescript-expert, drizzle-orm-patterns, postgresql-table-design
  - **Owned paths:** `server/src/db/schema/eval.ts`, `server/src/db/migrations/` (generated),
    `server/src/vendor/shared/contracts/eval-ci.ts`, `client/src/vendor/shared/contracts/eval-ci.ts`
  - **Depends-on:** none
  - **Covers:** AC-6 (batch_id/agent_version columns), AC-14, AC-16 (shapes); enables all others
  - **Risk:** low
  - **Known gotchas:** vendor mirrors are hand-kept in lockstep (CLAUDE.md do-not-touch is about
    *editing existing* symbols / migrations — additive new exports/columns are allowed but MUST land
    in both mirrors identically). `expected_output` must carry the discriminator explicitly. Pure
    additive columns use `db:generate` normally — only *renames* need the manual-SQL workaround.
  - **Acceptance:** `\d eval_runs` (after `pnpm db:migrate`) shows `batch_id uuid`, `agent_version
    integer`, both nullable, plus an index on `batch_id`; `cd server && npx tsc --noEmit` and
    `cd client && npx tsc --noEmit` both pass; `EvalRunBatch`, `EvalCompare`, `EvalExpectedOutput`
    importable from `@devdigest/shared` in both packages.

### Phase 2 — Server core units (parallel after T1)
- **T2 — Eval repository + container wiring**
  - **Action:**
    1. Create `server/src/modules/eval/repository.ts` (`EvalRepository`, ctor `(db)`), mirroring
       `blast/repository.ts`: `listCases(workspaceId, ownerKind, ownerId)`; `getCase(workspaceId,
       caseId)`; `insertCase(...)` returning the row; `insertRun(caseId, values: {..., batchId,
       agentVersion})` writing `batch_id`/`agent_version` as real columns (caller passes both in);
       `runsForCase`; `latestRunPerCase(ownerId)` (for AC-5 pass/fail); `batchesForOwner(workspaceId,
       ownerId)` **grouped by `batch_id`** (`WHERE batch_id IS NOT NULL`, defensively excluding any
       orphan legacy row — spec edge case); `runsForBatch(workspaceId, ownerId, batchId)`; workspace-
       wide `recentRuns` + per-agent dashboard rows. Every query filters `eval_cases.workspace_id`
       (AC-21). The caller (T5) generates one `batchId` (uuid) per "run all" invocation and passes
       it into every `insertRun` call for that batch — the repository does not invent it.
    2. Wire into `server/src/platform/container.ts`: add `private _evalRepo?`, a `get evalRepo()`
       lazy getter honoring `this.overrides.evalRepo` first, and an `evalRepo?: EvalRepository`
       field on `ContainerOverrides` (test injection) — copy the `blastRepo` pattern verbatim
       (`container.ts:58,79,108-110`).
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** drizzle-orm-patterns, onion-architecture, postgresql-table-design, typescript-expert
  - **Owned paths:** `server/src/modules/eval/repository.ts`, `server/src/platform/container.ts`
  - **Depends-on:** T1
  - **Covers:** AC-6 (persist rows sharing one `batch_id`), AC-14, AC-21, AC-23 (empty-set → no rows)
  - **Risk:** medium
  - **Known gotchas:** `eval_cases.owner_kind` is a text enum `['skill','agent']`; this lesson only
    writes `'agent'`. `batch_id`/`agent_version` are nullable columns (T1's migration) — every insert
    this feature makes sets both explicitly; grouping queries filter `batch_id IS NOT NULL` rather
    than assuming every row has one (spec edge case: a hypothetical orphan row is excluded, not a
    crash). `ran_at` stays `defaultNow()` per row — it's no longer the grouping key, just a
    display/ordering timestamp.
  - **Acceptance:** `cd server && npx tsc --noEmit` passes; a repository test inserts N rows with an
    identical `batch_id` and `runsForBatch` returns exactly those N; a row with `batch_id = null` is
    excluded from `batchesForOwner`.

- **T3 — Deterministic scorer + `verify:l06`**
  - **Action:**
    1. Create `server/src/modules/eval/scoring.ts` — pure functions, **no DB / no reviewer-core /
       no provider imports**. `regionsIntersect(a,b)` = same `file` AND inclusive `[start,end]`
       overlap (AC-8). `scoreCase({expectation, expectedRegions, actualRegions})` → per-case
       recall/precision contributions + `pass`. `aggregate(cases, {kept, produced})` → pooled
       recall (AC-9: matched must_find regions ÷ total must_find regions), pooled precision (AC-10:
       actual findings that are NOT noise ÷ actual findings; noise = matches a must_not_flag region
       OR matches no expected region; zero findings → precision 1), citation = kept ÷ produced
       (AC-11; produced 0 → 1), assembling the `EvalRun` aggregate (traces_passed/total/per_trace).
    2. Create `server/src/modules/eval/scoring.test.ts` — vitest cases proving: intersect
       true/false/different-file (AC-8); recall 2/3 (AC-9); a must_not_flag re-raise drops precision
       and an extra must_find finding is noise (AC-10); citation 3/4 (AC-11); **an injected provider
       that throws is never called** (AC-12); and two distinct prompts over one case yield different
       recall via a fixture of pre-computed actual findings (AC-13, scorer-level — no LLM).
    3. Add `"verify:l06": "vitest run src/modules/eval/scoring.test.ts"` to `server/package.json`,
       adjacent to `verify:l03` (line 14). Keep single-file scope, offline-green (AC-19).
  - **Module:** server
  - **Type:** core
  - **Skills to use:** typescript-expert, react-testing-library (vitest patterns), security
  - **Owned paths:** `server/src/modules/eval/scoring.ts`,
    `server/src/modules/eval/scoring.test.ts`, `server/package.json`
  - **Depends-on:** T1
  - **Covers:** AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-19
  - **Risk:** medium
  - **Known gotchas:** precision noise rule per resolved decision #3 — an actual finding matching NO
    expected region is noise even in a must_find-only set, not only must_not_flag hits. Aggregation
    is **pooled** (sum numerators ÷ sum denominators across cases), decided over macro-average
    (mean of per-case ratios) — pooled better reflects total noise/miss volume when cases produce
    different numbers of findings; do not average per-case ratios.
  - **Acceptance:** `cd server && pnpm verify:l06` passes with `OPENROUTER_API_KEY` unset and no
    network; the test that injects a throwing provider still returns metrics.

- **T4 — Eval run path (frozen-input composition)**
  - **Action:**
    1. Create `server/src/modules/eval/run.ts` exporting e.g. `runCase(container, agent,
       skillBodies, evalCase)`. Build the diff with `parseUnifiedDiff(evalCase.inputDiff)` from
       `server/src/adapters/git/diff-parser.js` (empty diff → empty `UnifiedDiff`, handled).
    2. Resolve the provider via `container.llm(agent.provider)` and call `reviewPullRequest({
       systemPrompt: agent.systemPrompt, model: agent.model, diff, llm, strategy: agent.strategy ??
       default, skills: skillBodies })` — **omit** `callers`, `repoMap`, `specs`, `intent`,
       `prDescription` entirely (AC-7: no live enrichment). Untrusted `input_diff` reaches the model
       only through `reviewPullRequest`→`assemblePrompt`/`wrapUntrusted` (AC-20 — inherited, do not
       hand-concatenate case text into the system prompt).
    3. Return `{ findings: outcome.review.findings, kept: outcome.review.findings.length,
       produced: outcome.review.findings.length + outcome.dropped.length }` so T3 can compute
       citation with zero grounding I/O.
    4. (Optional) `run.test.ts` with a mock `LLMProvider` (from `src/adapters/mocks.ts`) asserting
       two runs of an unchanged agent produce byte-identical prompt assembly (AC-7 observable) and
       that no `container.repoIntel` method is invoked.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, typescript-expert, security, fastify-best-practices
  - **Owned paths:** `server/src/modules/eval/run.ts`, `server/src/modules/eval/run.test.ts`
  - **Depends-on:** T1
  - **Covers:** AC-7, AC-20
  - **Risk:** medium
  - **Known gotchas:** the run path mirrors `mcp-server/src/cli/review.ts` (composition-root
    pattern) but lives in the module and reaches the LLM through `container.llm`, never a raw SDK.
    Do NOT route through `ReviewRunExecutor` (it assembles a real PR row + repo-intel — AC-7 forbids
    it). `reviewPullRequest`'s own prompt budget truncates oversized diffs (spec edge case — no new
    handling).
  - **Acceptance:** `cd server && npx tsc --noEmit` passes; with a mock provider, `runCase` returns
    `{findings, kept, produced}` and never touches `container.repoIntel`.

### Phase 3 — Server orchestration (after Phase 2)
- **T5 — Eval service: create-from-finding, list, run-batch**
  - **Action:**
    1. Create `server/src/modules/eval/service.ts`. `buildCaseDraftFromFinding(workspaceId,
       findingId)` — **does not touch `eval_cases` at all**, no insert: load the finding via
       `container.reviewRepo.findingContext(finding_id)`; **404 if it is not in the caller's
       workspace** (AC-21); derive `expectation` from persisted decision ONLY — `acceptedAt` set →
       `must_find`, `dismissedAt` set → `must_not_flag`, neither → 4xx (AC-1/AC-2/AC-4, never from
       request body); build `input_diff` from the finding's file diff fragment (empty string, not
       the whole raw diff, if the file isn't present in the stored PR diff — spec edge case),
       `expected_output = {expectation, regions:[{file,start_line,end_line,severity,category}]}`,
       `input_meta = {source_finding_id}`, `name` defaulted from the finding title. Return this
       **unpersisted** `EvalCaseInput` directly to the route.
    2. `createCase(workspaceId, input: EvalCaseInput)` — the ONE place that actually inserts an
       `eval_cases` row (used by both a manually-authored case and the modal's Save after a
       finding-derived draft, AC-3/AC-4). `safeParse`s `expected_output` against
       `EvalExpectedOutput` before insert; 4xx + persist nothing on failure (AC-22).
    3. `listCases(workspaceId, agentId)` → `EvalCase[]` joined with latest run pass/fail (AC-5).
    4. `runCaseOnce(workspaceId, caseId)` (single-case run, e.g. modal "Run case" / "Run on save") —
       generates its own one-row `batchId = randomUUID()`, same run+score+persist path as step 5
       below, for exactly one case.
    5. `runBatch(workspaceId, agentId)`: load cases; **empty set → return empty aggregate
       (traces_total 0), persist nothing** (AC-23); else resolve agent + enabled linked skill
       bodies once (`agentsRepo.linkedSkills`, filter `enabled && !injectionDetected`), generate one
       shared `batchId = randomUUID()`, loop cases sequentially: `run.runCase` → `scoring.scoreCase`;
       on per-case LLM failure record a failed row (`pass=null`, metrics null, `actual_output.error`
       set) and CONTINUE, retaining already-scored rows (AC-24); persist one `eval_runs` row per
       case with `batchId` and `agentVersion: agent.version` set as **real columns** (`insertRun`'s
       `values`, not inside `actual_output`); return the pooled `EvalRun` aggregate (AC-6).
    6. `service.test.ts`: draft-building on accepted→must_find vs dismissed→must_not_flag regardless
       of body, and asserts NO `eval_cases` row is created by the draft call (AC-1/AC-2/AC-4);
       `createCase` persists and returns the row (AC-3); cross-workspace finding → 404 (AC-21); empty
       set → traces_total 0, no rows (AC-23); mid-batch throw isolates + preserves siblings (AC-24);
       malformed payload → 4xx, no row (AC-22); a `runBatch` call's N rows all share one `batchId`
       and `agentVersion`.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, fastify-best-practices, zod, security, typescript-expert, drizzle-orm-patterns
  - **Owned paths:** `server/src/modules/eval/service.ts`, `server/src/modules/eval/service.test.ts`
  - **Depends-on:** T2, T3, T4
  - **Covers:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-22, AC-23, AC-24
  - **Risk:** high
  - **Known gotchas:** expectation derives from persisted `accepted_at`/`dismissed_at` on the
    `findings` row (`schema/reviews.ts:44-45`), NEVER from client input — but this only seeds the
    *draft*; `createCase` persists whatever the modal submits (safeParse-validated), since the user
    may have edited it. `findingContext` returns `{finding, review, pull}`
    (`reviews/repository.ts:113-118`) — `pull.workspaceId` is the ownership check; the review agent
    id is `review.agentId`. `buildCaseDraftFromFinding` must NEVER call `repo.insertCase` — a
    regression there would silently break the "review before save" guarantee (AC-1/AC-2).
  - **Acceptance:** `cd server && npx tsc --noEmit` + the listed `service.test.ts` cases pass;
    specifically assert `buildCaseDraftFromFinding` results in zero new `eval_cases` rows.

- **T6 — Eval analytics: history, compare, dashboard**
  - **Action:**
    1. Create `server/src/modules/eval/analytics.ts`. `history(workspaceId, agentId)` → grouped
       `EvalRunBatch[]` (aggregate per `batch_id`, carrying the `agent_version` column directly)
       (AC-14).
    2. `compare(workspaceId, agentId, batchIdA, batchIdB)` → `EvalCompare`: the two `EvalRunBatch`
       aggregates, `delta` (Δrecall/Δprecision/Δcitation), and a `prompt_diff` computed from the two
       versions' `system_prompt` resolved via `container.agentsRepo.getVersion(agentId, version)`
       (line-diff shape) (AC-14).
    3. `dashboard(workspaceId, ownerId|null)` → `EvalDashboard`: per-agent current metrics + delta
       vs previous batch + trend points + workspace `recent_runs`. Compute `alert` via
       `resolveAlert(owner)`, **priority-ordered**:
       a. Take the owner's two most recent batches (by `ran_at` desc). If fewer than 2 exist, skip
          to step (c).
       b. For every `case_id` present in both batches, compare `pass`. Collect cases whose `pass`
          went `true → false`. If any, sort by case `name` ascending and build the templated
          message for the first one — `must_not_flag` case → "New false positive: case '<name>' now
          flags a finding it previously didn't."; `must_find` case → "Regression: case '<name>' no
          longer finds the expected issue." Return this string (AC-25) — **do not fall through to
          the floor-warning**, regression takes priority.
       c. Otherwise, if the owner has `< 8` eval cases, return the floor-warning string (AC-17).
       d. Otherwise `alert = null`.
       Workspace-level dashboard (`owner_id` null) applies `resolveAlert` per agent, same function.
    4. `analytics.test.ts`: compare shows correct deltas + a prompt diff between two versions; an
       owner with 7 cases and no pass-flip yields the floor `alert` (AC-17); an owner with ≥8 cases
       where one seeded case's `pass` flips `true→false` between its last two batches yields the
       regression `alert` naming that case, taking priority even though the floor condition doesn't
       apply (AC-25); two flipped cases in the same pair resolve to the alphabetically-first case's
       message (tie-break); an owner with a single batch (no comparison possible) and ≥8 cases
       yields `null`.
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** onion-architecture, drizzle-orm-patterns, typescript-expert, zod
  - **Owned paths:** `server/src/modules/eval/analytics.ts`,
    `server/src/modules/eval/analytics.test.ts`
  - **Depends-on:** T2, T1
  - **Covers:** AC-14, AC-16, AC-17 (floor alert), AC-25 (regression alert, priority)
  - **Risk:** medium
  - **Known gotchas:** a "batch" is identified by its `batch_id` column (T1's migration); "current"
    batch = the one with the newest `ran_at` among distinct `batch_id`s (last-write-wins on
    concurrent batches, no locking — spec edge case). `agent_version` for the prompt diff is a real
    `eval_runs` column now (no jsonb parsing), resolved against the existing `agent_versions` table
    via `agentsRepo.getVersion(agentId, version)` (`agents/repository.ts:181`). `resolveAlert` needs
    per-case `pass` history across the last two batches, not just the pooled aggregate —
    `runsForBatch` (T2) must be queried for both `batch_id`s to diff case-by-case; do not compute the
    regression check from the aggregate `EvalRun` alone.
  - **Acceptance:** `cd server && npx tsc --noEmit` + `analytics.test.ts` deltas/alert cases pass,
    including the regression-takes-priority-over-floor case and the tie-break case.

- **T7 — Eval routes + module registration**
  - **Action:**
    1. Create `server/src/modules/eval/routes.ts` (default Fastify plugin, `withTypeProvider<
       ZodTypeProvider>`, `getContext(container, req)` for workspace scoping on every route,
       mirroring `blast/routes.ts`):
       - `POST /findings/:id/eval-case` → `buildCaseDraftFromFinding`, returns an **unpersisted**
         `EvalCaseInput` draft (200, no DB write) — AC-1/AC-2.
       - `POST /eval-cases` → `createCase`, the actual persist for both a manually-authored case and
         a (possibly-edited) finding-derived draft — 201 `EvalCase` — AC-3/AC-4.
       - `GET /agents/:id/eval-cases` (list, AC-5).
       - `POST /eval-cases/:id/run` → `runCaseOnce` (single-case run, used by modal "Run case" / "Run
         on save").
       - `POST /agents/:id/eval-runs` (run batch → aggregate `EvalRun`, AC-6).
       - `GET /agents/:id/eval-batches` (history, AC-14).
       - `GET /agents/:id/eval-compare` (query `a`,`b` **`batch_id`** → `EvalCompare`, AC-14).
       - `GET /eval/dashboard` (+ optional `?agentId=`, AC-16/17/25).
       Declare Zod `params`/`body`/`response`; no logic/DB/SDK in the route.
    2. Register the module: one import + one entry `eval` in `server/src/modules/index.ts` (the
       documented "ADD A MODULE" step).
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** fastify-best-practices, onion-architecture, zod, security
  - **Owned paths:** `server/src/modules/eval/routes.ts`, `server/src/modules/index.ts`
  - **Depends-on:** T5, T6
  - **Covers:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-14, AC-16, AC-21 (route-level `getContext` guard)
  - **Risk:** low
  - **Known gotchas:** modules are registered STATICALLY in `modules/index.ts` (no autoload —
    verified the `modules` registry object) — add BOTH the `import eval from './eval/routes.js'`
    line and the `eval,` registry entry or the routes never mount. Relative imports carry `.js`.
    Don't confuse the draft route (`POST /findings/:id/eval-case`, no persist) with the save route
    (`POST /eval-cases`, persists) — they are deliberately separate endpoints (AC-1/AC-2 vs AC-3/AC-4).
  - **Acceptance:** `cd server && npx tsc --noEmit` passes; server boots and all eight routes respond
    (a manual `inject` smoke or the existing route test harness); hitting the draft route twice never
    creates a row, only `POST /eval-cases` does.

- **T8 — Seed ≥8 eval cases (AC-17 deliverable)**
  - **Action:**
    1. Create `server/src/db/seed-eval.ts` inserting ≥8 `owner_kind='agent'` cases (mix of
       `must_find` and `must_not_flag`, each with a real `input_diff` fragment + a valid
       `expected_output` payload) for the seeded starter/demo agent, so it shows **no** floor alert.
    2. Invoke it from `server/src/db/seed.ts` (follow the existing `seed-prompts.ts` import pattern).
  - **Module:** server
  - **Type:** backend
  - **Skills to use:** drizzle-orm-patterns, typescript-expert, zod
  - **Owned paths:** `server/src/db/seed-eval.ts`, `server/src/db/seed.ts`
  - **Depends-on:** T2
  - **Covers:** AC-17 (seed part)
  - **Risk:** low
  - **Known gotchas:** seed payloads must satisfy `EvalExpectedOutput.safeParse` (same schema the
    write path enforces) or the seeded cases will be unusable by the scorer.
  - **Acceptance:** `cd server && pnpm db:seed` (against a test DB) creates ≥8 cases for one agent;
    the dashboard for that agent returns `alert: null`.

### Phase 4 — Client (parallel after T1; functionally consume Phase 3 endpoints)
- **TC1 — Eval API client + query keys**
  - **Action:**
    1. In `client/src/lib/api.ts`, add eval functions using the existing `api.get/post/put` helpers
       (`api.ts:67-76`): `draftEvalCaseFromFinding(findingId)` (calls `POST /findings/:id/eval-case`,
       returns an **unpersisted** `EvalCaseInput`); `createEvalCase(input: EvalCaseInput)` (calls
       `POST /eval-cases`, persists, returns `EvalCase` — used for both manual and finding-derived
       saves); `fetchEvalCases(agentId)`; `runEvalCase(caseId)` (calls `POST /eval-cases/:id/run`,
       used by modal "Run case" / "Run on save"); `runEvalBatch(agentId)`; `fetchEvalBatches(agentId)`;
       `fetchEvalCompare(agentId, batchIdA, batchIdB)`; `fetchEvalDashboard(agentId?)`; plus a
       `promoteVersion(agentId, version)` helper that composes the EXISTING
       `GET /agents/:id/versions/:version` then `PUT /agents/:id` with the snapshot's
       `system_prompt` (client-side compose — no new endpoint, per resolved decision #1, AC-15).
       Type every return from `@devdigest/shared` (`EvalCase`, `EvalCaseInput`, `EvalRun`,
       `EvalRunBatch`, `EvalCompare`, `EvalDashboard`) — never hand-duplicate.
    2. Add a stable query-key factory `evalQueryKeys` (mirror `onboardingQueryKeys`, `api.ts:81`):
       `cases(agentId)`, `batches(agentId)`, `compare(agentId,a,b)`, `dashboard(agentId?)`.
  - **Module:** client
  - **Type:** ui
  - **Skills to use:** frontend-architecture, react-best-practices, typescript-expert
  - **Owned paths:** `client/src/lib/api.ts`
  - **Depends-on:** T1
  - **Covers:** AC-15 (promote compose), plumbing for AC-1/2/3/4/5/6/14/16
  - **Risk:** low
  - **Known gotchas:** all API access + query keys live ONLY in `lib/api.ts` (client CLAUDE.md).
    POST helpers must send a JSON body (even `{}`) so Fastify sets `application/json` on
    body-schema routes (see `generateOnboarding` note, `api.ts:106-116`). Do not conflate
    `draftEvalCaseFromFinding` (never persists) with `createEvalCase` (always persists) — they hit
    two different routes on purpose.
  - **Acceptance:** `cd client && npx tsc --noEmit` passes; all eight functions + `promoteVersion` +
    `evalQueryKeys` are exported and typed from `@devdigest/shared`.

- **TC2 — `EvalCaseModal` (shared: manual create, finding-derived draft, edit existing)**
  - **Action:**
    1. Create `client/src/components/EvalCaseModal/EvalCaseModal.tsx` (+ `index.ts`) — a single
       reusable modal taking `{ initial: EvalCaseInput; caseId?: string; onSaved: (c: EvalCase) =>
       void; onClose: () => void }`. Renders: `name` field; Diff/Files/PR-meta tabs (`input_diff` /
       `input_files` / `input_meta`, editable); a JSON editor over `expected_output` (validated
       client-side against `EvalExpectedOutput` before enabling Save — mirrors the server's
       `safeParse`, AC-22); a "Run on save" toggle; **Cancel** (calls `onClose`, no request fired
       beyond whatever already-fetched the `initial` draft); **Save** (calls `createEvalCase` (TC1)
       with the current form state, then `runEvalCase` if the toggle is on, then `onSaved`); when
       `caseId` is provided (editing an existing, already-persisted case, e.g. opened from the Evals
       tab) also show a **Run case** button (`runEvalCase(caseId)`, TC1) and the case's last-run
       status line ("Last run passed — expected 1 finding, got 1 — 1.8s — $0.02" style, from
       `fetchEvalCases`' latest-run data).
    2. Add modal strings to `client/messages/en/eval.json` (namespace already exists).
  - **Module:** client
  - **Type:** ui
  - **Skills to use:** react-best-practices, react-testing-library, frontend-architecture, zod
  - **Owned paths:** `client/src/components/EvalCaseModal/`, `client/messages/en/eval.json`
  - **Depends-on:** TC1
  - **Covers:** AC-3, AC-4, AC-22 (client-side validation mirror)
  - **Risk:** medium
  - **Known gotchas:** this component is shared by TC3 (finding-derived) and TC4 (manual "New eval
    case" + editing an existing row) — do not fork it per call-site; the only variance is the
    `initial` payload and whether `caseId` is present. Save must call `createEvalCase`
    **unconditionally** even when the draft came from a finding — the draft endpoint never persists
    (AC-1/AC-2), only this modal's Save does (AC-3/AC-4).
  - **Acceptance:** `cd client && npx tsc --noEmit` + an RTL test: Cancel fires no `createEvalCase`
    call; Save fires exactly one; Save with "Run on save" on fires `createEvalCase` then
    `runEvalCase`; an invalid `expected_output` edit disables Save.

- **TC3 — "Turn into eval case" button on FindingCard**
  - **Action:**
    1. In `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`,
       add a "Turn into eval case" control; **disabled unless `f.accepted_at || f.dismissed_at`**
       (AC-3) with an `aria-label`. It calls a new `onCreateEvalCase?` callback prop (keep
       `FindingCard` presentational, consistent with the existing `onAction` pattern).
    2. In `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`,
       wire `onCreateEvalCase={() => draftMutation.mutate(f.id)}` using a TanStack `useMutation` over
       `draftEvalCaseFromFinding` (TC1) — mirror the existing `action.mutate({findingId…})` wiring at
       `FindingsPanel.tsx:88`. On success, open `EvalCaseModal` (TC2) with `initial` set to the
       returned draft (no `caseId` — it isn't persisted yet). One draft-fetch request per click; the
       actual create only happens if the user then clicks Save inside the modal (AC-1/AC-2/AC-3).
    3. Add the button label/aria strings to `client/messages/en/prReview.json` under the namespace
       `FindingCard` already uses (grep-verify the `useTranslations("…")` namespace in
       `FindingCard.tsx` before adding — it renders `t("finding.accept")`, so the key sits beside
       the existing `finding.*` keys).
  - **Module:** client
  - **Type:** ui
  - **Skills to use:** react-best-practices, react-testing-library, frontend-architecture, security
  - **Owned paths:**
    `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`,
    `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`,
    `client/messages/en/prReview.json`
  - **Depends-on:** TC1, TC2
  - **Covers:** AC-1, AC-2 (trigger), AC-3
  - **Risk:** medium
  - **Known gotchas:** `FindingCard` is presentational and receives `onAction` from `FindingsPanel`
    (verified `FindingsPanel.tsx:80-88`); keep the new action the same shape (callback prop wired by
    the panel) rather than fetching inside the card. `FindingRecord` exposes `accepted_at` /
    `dismissed_at` (`FindingCard.tsx:50-51`) — drive the disabled state from those. Clicking the
    button does NOT create a case by itself — it only opens the modal (TC2); do not regress to a
    direct atomic create.
  - **Acceptance:** `cd client && npx tsc --noEmit` + an RTL test: a decision-less finding renders
    the control disabled; an accepted finding enables it, clicking fires exactly one draft-fetch
    call and opens `EvalCaseModal` with a non-empty `expected_output`; no `createEvalCase` call
    happens until the modal's own Save is clicked.

- **TC4 — "Evals" tab in the Agent editor (list · run · history · compare · promote)**
  - **Action:**
    1. Register the tab in BOTH places or it silently redirects to config: add
       `{ key: "evals", labelKey: "editor.tabs.evals", icon: <existing IconName> }` to `TABS` in
       `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, AND add `"evals"` to
       `VALID_TABS` in `client/src/app/agents/[id]/page.tsx:15`.
    2. Render the tab from `AgentEditor.tsx` (add the `evals` branch alongside config/skills/context).
    3. Create `…/AgentEditor/_components/EvalsTab/EvalsTab.tsx` (+ `index.ts`): case list with
       name, expectation, region `file:line`, severity/category badge, and latest pass/fail icon
       (AC-5), each row opening `EvalCaseModal` (TC2) with `caseId` set for editing/re-running; a
       "New eval case" button opening the same modal with a blank `initial` and no `caseId`; a "Run
       all evals" button → `runEvalBatch` (TC1) showing the returned metric cards (AC-6); run
       history as `EvalRunBatch[]` (AC-14); a compare view (pick two batches → `fetchEvalCompare`,
       render Δrecall/Δprecision/Δcitation + the `system_prompt` line diff) and a "Promote vN"
       button calling `promoteVersion` (TC1) (AC-14/AC-15). All strings via `useTranslations("agents")`.
    4. Add the new keys (`editor.tabs.evals`, list/run/compare/promote labels) to
       `client/messages/en/agents.json`.
  - **Module:** client
  - **Type:** ui
  - **Skills to use:** frontend-architecture, react-best-practices, react-testing-library, next-best-practices, typescript-expert
  - **Owned paths:**
    `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/` (new dir),
    `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`,
    `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`,
    `client/src/app/agents/[id]/page.tsx`,
    `client/messages/en/agents.json`
  - **Depends-on:** TC1, TC2
  - **Covers:** AC-5, AC-6 (UI), AC-14, AC-15
  - **Risk:** high
  - **Known gotchas (client/INSIGHTS.md):** the tab MUST be added to BOTH `AgentEditor/constants.ts`
    `TABS` and `agents/[id]/page.tsx` `VALID_TABS` (verified both list only config/skills/context) —
    omitting `VALID_TABS` makes `?tab=evals` silently fall back to `config` (`page.tsx:27`). Pick an
    icon that already exists in `vendor/ui/icons.tsx` (`Target`/`Gauge`/`BarChart` exist;
    `BarChart2` does NOT). Promote is a client-side compose of existing endpoints — no new server
    route (decision #1). Reuse `EvalCaseModal` (TC2) rather than building a second case form.
  - **Acceptance:** `cd client && npx tsc --noEmit` passes; navigating `?tab=evals` renders the tab
    (not config); an RTL test renders one row per case with a pass/fail icon and fires one run call.

- **TC5 — Eval Dashboard page + sidebar item**
  - **Action:**
    1. Create `client/src/app/eval/page.tsx` (RSC shell) + `_components/` client pieces: one card per
       agent with current recall/precision/citation, delta vs previous batch, a trend sparkline, and
       a "recent eval runs · all agents" table — mapping `EvalDashboard` rows via `fetchEvalDashboard`
       (TC1) (AC-16). Surface the floor-warning or regression `alert` when present (AC-17/AC-25).
    2. Add ONE sidebar item under the existing `SKILLS LAB` group in `client/src/vendor/ui/nav.ts`
       (append to the `items` array at nav.ts:32-36): `{ key: "eval", label: "Eval Dashboard",
       icon: <existing>, href: "/eval" }`. Do **NOT** edit `activeKeyFor` — it already maps `/eval`
       → `"eval"` (verified `components/app-shell/helpers.ts:35`).
    3. Add dashboard strings to `client/messages/en/eval.json` (namespace already exists).
  - **Module:** client
  - **Type:** ui
  - **Skills to use:** next-best-practices, frontend-architecture, react-best-practices, react-testing-library
  - **Owned paths:** `client/src/app/eval/` (new dir), `client/src/vendor/ui/nav.ts`,
    `client/messages/en/eval.json`
  - **Depends-on:** TC1
  - **Covers:** AC-16, AC-17 (floor alert + UI), AC-18, AC-25 (regression alert + UI)
  - **Risk:** medium
  - **Known gotchas:** the `nav.ts` item `key` MUST equal `"eval"` to match `activeKeyFor`'s return
    so the item highlights on `/eval` (AC-18). Icon must exist in `vendor/ui/icons.tsx`. RSC by
    default — mark only interactive/browser-API pieces `"use client"`. `alert` is a single string
    regardless of which of the two reasons (AC-17/AC-25) produced it — render it generically, don't
    try to branch UI on its cause.
  - **Acceptance:** `cd client && npx tsc --noEmit` passes; `/eval` renders one card per agent + a
    recent-runs table; the sidebar shows the item and it is active-highlighted on `/eval`.

## Testing strategy
- **Scorer unit + `verify:l06` (AC-8..13, AC-19):** `cd server && pnpm verify:l06` — must pass with
  no network and `OPENROUTER_API_KEY` unset (inject a throwing provider). This is the lesson's gate.
- **Server module tests:** `cd server && npx vitest run src/modules/eval/` — repository (batch
  `ran_at`), run path (frozen assembly, no repo-intel), service (create-from-finding derivation,
  workspace 404, empty set, mid-batch isolation, malformed payload 4xx), analytics (compare deltas,
  floor alert). Mocks via `src/adapters/mocks.ts` + `ContainerOverrides`.
- **Server typecheck + layering:** `cd server && npx tsc --noEmit` and `cd server && npm run
  depcruise` (the new `eval` module must import inward only; `scoring.ts` must import neither
  `reviewer-core` nor `db/schema`).
- **Client component tests:** `cd client && npx vitest run` — FindingCard disabled/enabled + single
  create call; EvalsTab renders rows + fires run; dashboard maps rows + shows floor alert.
- **Client typecheck:** `cd client && npx tsc --noEmit`.
- **Contracts:** both `npx tsc --noEmit` runs prove the two vendor mirrors stayed in lockstep.

## Risks & mitigations
- **Run execution model is a defaulted assumption (sequential synchronous).** → If the user wants
  async queued+SSE, T5 grows bus wiring + an active-runs route and a client polling task is added;
  flagged in Open questions. Confirm before dispatching T5/T7.
- **Vendor-mirror drift** (T1 lands in one mirror only) → `tsc` in the OTHER package fails; the
  Acceptance runs both typechecks. Keep the two `eval-ci.ts` edits byte-identical.
- **Scorer accidentally importing I/O** (pulls in `reviewer-core`/DB, breaking AC-12 offline) →
  `depcruise` + the throwing-provider test catch it; T3 owns `scoring.ts` with zero such imports.
- **Batch identity — RESOLVED, not a residual risk.** Originally considered a `ran_at`-proxy (with a
  timestamp-collision risk on concurrent batches); superseded by T1's explicit `batch_id` uuid
  column, which removes the collision risk entirely. Two concurrent "run all" batches now simply get
  two distinct `batch_id`s; "current" is still last-write-wins by newest `ran_at` (no locking — an
  accepted, unrelated simplification, not a data-integrity gap).
- **Prompt-injection via `input_diff`** → inherited hardening: the run path only reaches the model
  through `reviewPullRequest`→`assemblePrompt`/`wrapUntrusted` (AC-20); never hand-concatenate.
- **Out-of-scope temptations** (dedupe by `source_finding_id`, diff-drift indicator, skill-owner
  evals, Conformance/Compose-Review/`evals/` harness) → NOT built; they are the spec's PROPOSALs /
  Non-goals and stay out of the task list.

## Red-flags check
- [x] Every requirement maps to a task (AC-1..25 covered across T1..T8, TC1..TC5 — see matrix below)
- [x] Every AC-N is covered by at least one task's `Covers`
- [x] No specification was authored or edited — `specs/…` taken as input only
- [x] Execution mode recorded (multi-agent, defaulted) and the plan is shaped for it
- [x] Dependencies form a DAG (T1 → {T2,T3,T4} → {T5(+T3,T4),T6,T8} → T7; T1 → TC1 → TC2 →
      {TC3,TC4} → (TC5 depends only on TC1)) — no cycles
- [x] (multi-agent) Concurrent tasks have non-overlapping Owned paths (verified: no file appears in
      two tasks; i18n split per-namespace file; `container.ts`/`index.ts`/`package.json`/`nav.ts`/
      `schema/eval.ts` each owned by exactly one task)
- [x] Every Acceptance is measurable (a command result / test name / observable render)
- [x] Shared-contract change is additive-only and explicitly called out (T1 — no existing symbol
      edited; migration is two new nullable columns, no existing column touched)
- [x] No AC prose restated from the spec (referenced by ID; traceability matrix uses IDs)
- [x] No task `Action` has 10+ numbered steps; no sub-5-minute sibling tasks left unmerged
      (`verify:l06` folded into T3; container wiring folded into T2; migration folded into T1)
- [x] Every cross-cutting Owned path is grep-verified (`container.ts:79/108-110`, `index.ts` registry,
      `page.tsx:15/27`, `AgentEditor/constants.ts` TABS, `nav.ts:32-36`, `helpers.ts:35`,
      `FindingsPanel.tsx:88`, `reviews/repository.ts:113-118`, `agents/repository.ts:181`,
      `agents.ts:38-48` for `agent_versions`' composite PK)
- [x] Every deleted/narrowed shared symbol has all consumers assigned — N/A (no deletions/narrowing;
      all contract changes are additive; `agent_version` moved OUT of `actual_output` jsonb into a
      real column — the one payload-shape narrowing here — T1 owns both sides of that move)
- [x] Every new runner/registry-discovered file cites its discoverer: server module via
      `modules/index.ts` registry (T7); i18n namespaces via `readdirSync` in `i18n/request.ts`
      (TC2/TC3/TC4/TC5); `verify:l06` scoring test via the `vitest run <path>` script (T3); migration
      file via `db:migrate`'s journal (T1)

## AC → task traceability (IDs only)
| AC | Tasks | AC | Tasks |
|----|-------|----|-------|
| AC-1 | T1, T5, T7, TC1, TC2, TC3 | AC-14 | T1, T6, T7, TC1, TC4 |
| AC-2 | T5, T7, TC3 | AC-15 | TC1, TC4 |
| AC-3 | T5, T7, TC2, TC3 | AC-16 | T6, T7, TC1, TC5 |
| AC-4 | T5, T7, TC2, TC3 | AC-17 | T6, T8, TC5 |
| AC-5 | T5, T7, TC4 | AC-18 | TC5 |
| AC-6 | T1, T2, T5, T7, TC1, TC4 | AC-19 | T3 |
| AC-7 | T4 | AC-20 | T4 |
| AC-8 | T3 | AC-21 | T2, T5, T7 |
| AC-9 | T3 | AC-22 | T5, TC2 |
| AC-10 | T3 | AC-23 | T2, T5 |
| AC-11 | T3, T4 | AC-24 | T5 |
| AC-12 | T3 | AC-25 | T6, TC5 |
| AC-13 | T3 | | |
