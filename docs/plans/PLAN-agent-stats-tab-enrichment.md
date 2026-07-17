# Implementation Plan: Agent Stats tab enrichment

Status: APPROVED — both defaulted decisions confirmed by the requester on 2026-07-17:
join-derived per-run finding count for the `cost_by_category` divisor, and multi-agent
(parallel) execution mode. Both are now normative; no change to the task graph below.

## Overview
Targeted enrichment of the already-shipping per-agent **Stats** tab. We extend the existing
`agent-performance` module and `AgentStats` contract with three additive aggregates, add one new
paginated `GET /agents/:id/runs` endpoint, and upgrade the tab's rendering (sparkline, accept-rate
gauge, cost delta, time-bucketed stacked severity chart, findings-by-category donut, and a Run
History table that reuses the existing `RunTraceDrawer`). No new LLM/model calls, no new columns,
no new migration.

## Execution mode
multi-agent (parallel) — DEFAULTED (AskUserQuestion unavailable). The work spans a shared contract
plus independent backend and client surfaces, which parallelises cleanly after a contracts-first
root. If the user prefers single-agent, collapse the DAG below to the linear order
T1 → T2 → T3 → T4 → T5 → T6 (owned-path non-overlap stops being a constraint); no task changes.

## Requirements (verified)
- Source: `specs/SPEC-2026-07-17-agent-stats-tab-enrichment.md` (approved) — ACs: AC-1..AC-17.
- Verified implementable against the real code (not just the spec prose). Confirmations:
  - `agent-performance` module already serves `/agents/:id/stats` via
    `routes.ts` → `service.ts` → `repository.ts` → `helpers.ts`; enrichment extends these files.
    Agreed with the spec's "Design decision": this is an enrichment, **not** a new module.
  - `AgentStats` lives in `server/src/vendor/shared/contracts/observability.ts:96-119`, mirrored
    byte-identically in `client/src/vendor/shared/contracts/observability.ts`; both barrels export
    it at `index.ts:25`. Three additive fields go into both copies.
  - `FindingCategory = z.enum(['bug','security','perf','style','test'])` exists at
    `server/src/vendor/shared/contracts/findings.ts:14` (client mirror) — reused for
    `cost_by_category`, no new enum.
  - All Run History columns exist on `agent_runs` (`server/src/db/schema/runs.ts`): `tokens_in/out`,
    `cost_usd`, `findings_count`, `source ('local'|'ci')`, `status`, `ran_at`, `pr_id`
    (`ON DELETE set null` → supports AC-9). `has_trace` is derived by LEFT JOIN on `run_traces`
    (`runs.ts:54`). PR link fields come from `pull_requests` (`schema/pulls.ts`: `number`, `repoId`,
    `title`). No new column → aligns with the spec Non-goal; **no migration task**.
  - Precedent for the new endpoint: `GET /pulls/:id/runs` (`server/src/modules/reviews/routes.ts:101`,
    "all runs incl. failures") and its repo mapping `run.repo.ts:listRunsForPull`.
  - Trace reuse: `GET /runs/:id/trace` (`reviews/routes.ts:121`) + default-export `RunTraceDrawer`
    (`client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.tsx`,
    props `{ runId, agentName?, prNumber?, running?, onClose }`).
- Deltas / disputes: none. Two normative open questions in the spec (adaptive severity buckets;
  cost delta shows $ + % + direction colour) are resolved and folded into the tasks below.

## Open questions & recommendations
- Q (DEFAULTED): `cost_by_category` divisor for `cost_per_finding = run.cost_usd / run.findings_total`.
  → default: **join-derived per-run finding count** (count of findings actually summed for that run
  via `reviews.run_id → findings`), NOT the stored `agent_runs.findings_count` column. Rationale:
  guarantees `Σ cost_per_finding == run.cost_usd`, so AC-7's observable "segment sum ≈ window total
  cost modulo excluded runs" holds exactly; the stored column can drift from persisted findings.
- Rec: keep the three new `AgentStats` fields **required** (not `.optional()`). They are always
  computable server-side (null-valued when unpriced/empty), and required fields keep the client
  render logic branch-free. Cost: every `AgentStats` fixture/constructor must supply them — swept
  and assigned to tasks below.
- Rec (out of scope, spec Proposals): sparkline+delta on the AVG DURATION card and source/status
  filtering on Run History are explicitly deferred by the spec — not planned here.

## Affected modules & contracts
- **server / `@devdigest/shared`** — extend `AgentStats` (+3 fields); add `RunHistoryRow` +
  `AgentRunHistory` (paginated) contract in `contracts/observability.ts` (both vendored copies).
- **server / `agent-performance`** — new repository queries (prev-window avg cost, severity buckets,
  cost-by-category, paginated run history), pure bucketing/prev-window helpers, service enrichment
  + new `getAgentRuns`, new route `GET /agents/:id/runs`.
- **client / `@devdigest/web`** — `api.ts` fetcher + query key + hook for the runs endpoint; new
  presentational chart/table components; `StatsTab.tsx` integration; `agents.json` i18n.
- Contracts: `AgentStats` extended (additive, callout below); `RunHistoryRow` + `AgentRunHistory`
  added. No existing contract field changed or removed.

## Architecture changes
- `AgentStats` (`server/src/vendor/shared/contracts/observability.ts` + client mirror) gains
  `avg_cost_usd_prev: number|null`, `severity_by_bucket: Array<{label,CRITICAL,WARNING,SUGGESTION}>`,
  `cost_by_category: Array<{category: FindingCategory, cost_usd: number}>`. **Additive extension of
  an existing cross-package contract** — both vendored copies edited together, kept byte-identical.
- New paginated contract `AgentRunHistory { rows: RunHistoryRow[], page, limit, total }` in the same
  file (both copies).
- Onion layering held: raw SQL stays in `repository.ts` (Infrastructure); bucketing/prev-window are
  pure functions in `helpers.ts` (Application-support); orchestration in `service.ts`; Zod I/O in
  `routes.ts` (Transport). The module's existing grep gate (no `LLMProvider`/`run-executor` import)
  and `npm run depcruise` must stay green — none of the new code touches an adapter or the LLM port.

## Phased tasks
<!-- Orchestrator: implementer-backend for Type backend/core; implementer-ui for Type ui/e2e. -->

### Phase 1 — Contracts (DAG root)
- **T1 — Extend AgentStats + add RunHistory contracts (both vendored copies)**
  - **Action:**
    1. In `server/src/vendor/shared/contracts/observability.ts`, add to the `AgentStats` object
       (after `findings_by_severity`, before `trend`) the three additive fields:
       `avg_cost_usd_prev` (`number|null`), `severity_by_bucket` (array of
       `{ label: string; CRITICAL/WARNING/SUGGESTION: int }`), `cost_by_category` (array of
       `{ category: FindingCategory; cost_usd: number }`), importing `FindingCategory` from
       `./findings.js`.
    2. In the same file add `RunHistoryRow` (fields per spec Contracts §RunHistoryRow: `run_id`,
       `ran_at`, `pr_number|null`, `pr_title|null`, `pr_repo_id|null`, `tokens_in|null`,
       `tokens_out|null`, `cost_usd|null`, `findings_count|null`, `source: enum['local','ci']`,
       `status: string|null`, `has_trace: boolean`) and `AgentRunHistory`
       (`{ rows: RunHistoryRow[]; page: int; limit: int; total: int }`), each with an exported
       `z.infer` type.
    3. Copy the exact same edits into `client/src/vendor/shared/contracts/observability.ts` so the
       two files stay **byte-identical** (project convention for vendored shared).
    4. Add a parse/round-trip fixture for the enriched `AgentStats` and `AgentRunHistory` to
       `server/test/contracts.test.ts` (import both from `@devdigest/shared`).
  - **Module:** server (+ shared) · **Type:** core
  - **Skills to use:** zod, typescript-expert
  - **Owned paths:** `server/src/vendor/shared/contracts/observability.ts`,
    `client/src/vendor/shared/contracts/observability.ts`, `server/test/contracts.test.ts`
  - **Depends-on:** none
  - **Covers:** AC-3, AC-6, AC-7, AC-8 (contract surface for each)
  - **Risk:** low
  - **Known gotchas:** a third, **generated** copy of the `AgentStats` schema is bundled at
    `server/src/modules/ci/assets/runner/index.js:20400` — do NOT hand-edit it; it is a build
    artifact and additive fields do not break it (the CI runner produces runs, never parses stats).
    Barrels already re-export this file (`index.ts:25`) — no barrel edit needed.
  - **Acceptance:** `cd server && npx tsc --noEmit` passes; `cd server && npm test -- contracts`
    green; the two `observability.ts` copies are byte-identical (`diff` of the two files is empty).

### Phase 2 — Backend (parallel after T1)
- **T2 — Repository: prev-window cost, severity buckets, cost-by-category, paginated run history**
  - **Action:**
    1. Add `avgCostPrevWindow(workspaceId, agentId, prevWindow)` — `AVG(cost_usd) FILTER (cost_usd
       IS NOT NULL)` over `status='done'` runs in the preceding equal-length window; returns
       `number|null`. (Window math itself is computed in helpers — T3 — and passed in.)
    2. Add `severityBucketRows(workspaceId, agentId, window)` returning raw
       `{ ran_at, severity }` per finding (join `agent_runs ar → reviews r ON r.run_id=ar.id AND
       r.agent_id=ar.agent_id → findings f`, window+workspace+agent scoped, `status='done'`).
       Bucketing is done in the pure helper (T3), not in SQL, so the adaptive granularity stays
       testable.
    3. Add `costByCategoryRows(workspaceId, agentId, window)` returning per-priced-run
       `{ category, cost_usd, run_finding_count }` where `run_finding_count` is the **join-derived**
       count of findings for that run (default divisor decision) — group so the helper computes
       `Σ (cost_usd / run_finding_count)` per category, excluding `cost_usd IS NULL` and
       `run_finding_count = 0` runs.
    4. Add `runHistory(workspaceId, agentId, window, limit, offset)` and
       `runHistoryCount(workspaceId, agentId, window)`: `agent_runs` LEFT JOIN `pull_requests`
       (`pr_id`) for `number/title/repo_id`, LEFT JOIN `run_traces` for
       `has_trace = (run_traces.run_id IS NOT NULL)`; select `tokens_in/out, cost_usd,
       findings_count, source, status, ran_at`; **all statuses** (no `status='done'` filter);
       `ORDER BY ran_at DESC LIMIT/OFFSET`. Window = `ran_at` between bounds.
    5. In `constants.ts` add `RUN_HISTORY_DEFAULT_LIMIT = 25`, `RUN_HISTORY_MAX_LIMIT = 100`,
       `SEVERITY_BUCKET_TARGET = 7` (≈6-8).
  - **Module:** server · **Type:** backend
  - **Skills to use:** drizzle-orm-patterns, postgresql-table-design, onion-architecture, typescript-expert, security
  - **Owned paths:** `server/src/modules/agent-performance/repository.ts`,
    `server/src/modules/agent-performance/constants.ts`
  - **Depends-on:** T1
  - **Covers:** AC-6, AC-7, AC-8, AC-9, AC-11, AC-12
  - **Known gotchas:** postgres-js rejects `= ANY($arr)` — but here every filter is a scalar
    `agent_id = ${id}::uuid` (single agent), so no ARRAY binding needed (see the module header note
    in `repository.ts`). `db.execute()` returns `timestamptz` as a string and `AVG(int)`/bigint
    counts as strings — cast with `new Date()` / `Number()`. Run History reads all statuses, so it
    does not benefit from the `status='done'` prefix of `agent_runs_agent_id_status_ran_at_idx`;
    the leading `agent_id` still serves it — acceptable per spec perf note, no new index.
  - **Acceptance:** new repo methods exported and typed; `cd server && npx tsc --noEmit` passes;
    covered by T3's added unit/integration tests (repo methods exercised there).
- **T3 — Helpers + service + route + backend tests**
  - **Action:**
    1. In `helpers.ts`: add `previousWindow(window): TimeWindow` (shift back by
       `toTs − fromTs`); add `bucketSeverity(rows, window, target)` → adaptive buckets
       (choose bucket unit so bucket count ≈ `SEVERITY_BUCKET_TARGET`, never 1 for short windows;
       oldest→newest; each `{label, CRITICAL, WARNING, SUGGESTION}`); add `sumCostByCategory(rows)`
       → per-category `Σ cost_usd/run_finding_count` excluding null-cost/zero-finding runs; add
       `toRunHistoryRow(raw)` mapper.
    2. Extend `toAgentStats(agg, trend, extras)` with a third `extras` arg
       `{ avgCostUsdPrev, severityByBucket, costByCategory }` and emit the three new fields.
       Update the three unit call sites in `agent-performance.test.ts` (`:247,:258,:269`).
    3. In `service.ts` `getAgentStats`: fetch the three new aggregates in the existing
       `Promise.all` (prev-window avg cost via `previousWindow`, severity rows→`bucketSeverity`,
       category rows→`sumCostByCategory`) and pass them into `toAgentStats`.
    4. In `service.ts` add `getAgentRuns(workspaceId, agentId, window, page, limit)`: verify agent
       ownership with the existing `container.agentsRepo.getById` guard (throw `NotFoundError` when
       absent — AC-13), clamp `limit` to `[1, RUN_HISTORY_MAX_LIMIT]`, compute offset, call
       `runHistory` + `runHistoryCount`, map rows via `toRunHistoryRow`, return `AgentRunHistory`.
    5. In `routes.ts` add `app.get('/agents/:id/runs', { schema: { params: IdParams, querystring:
       WindowQuery.extend({ page, limit }) } }, …)` — reuse `getContext`, `validateWindowQuery`,
       `resolveWindow`; `return AgentRunHistory.parse(result)`. (Parametric path, sits beside
       `/agents/:id/stats`; the file's route-precedence note already covers static-vs-parametric.)
    6. Add server tests: unit for `bucketSeverity`/`sumCostByCategory`/`previousWindow` in
       `agent-performance.test.ts`; route/integration for `GET /agents/:id/runs` (pagination clamp,
       window scope, ownership 404, `has_trace` gate) and enriched `/stats` in `routes.test.ts`.
  - **Module:** server · **Type:** backend
  - **Skills to use:** fastify-best-practices, onion-architecture, zod, typescript-expert, security
  - **Owned paths:** `server/src/modules/agent-performance/helpers.ts`,
    `server/src/modules/agent-performance/service.ts`,
    `server/src/modules/agent-performance/routes.ts`,
    `server/src/modules/agent-performance/agent-performance.test.ts`,
    `server/src/modules/agent-performance/routes.test.ts`
  - **Depends-on:** T1, T2
  - **Covers:** AC-3, AC-5, AC-6, AC-7, AC-8, AC-12, AC-13
  - **Known gotchas:** the module's grep gate forbids importing `LLMProvider`/`run-executor` —
    none of this needs them. Keep ownership check identical to `getAgentStats` (`getById` → 404)
    so cross-workspace ids never leak rows (AC-13). Preserve "exclude, don't zero": unpriced /
    zero-finding runs contribute nothing to `cost_by_category`; `avg_cost_usd_prev` is null when
    the previous window has no priced runs (AC-3 renders "—").
  - **Acceptance:** `cd server && npm test -- agent-performance` and `-- routes` green;
    `cd server && npx tsc --noEmit` passes; `cd server && npm run depcruise` stays green.

### Phase 3 — Client data plumbing (parallel after T1)
- **T4 — Client api fetcher + query key + hook for the runs endpoint**
  - **Action:**
    1. In `client/src/lib/api.ts`: add `fetchAgentRuns(agentId, window, page, limit)` hitting
       `GET /agents/:id/runs${windowToQuery(window)}&page=&limit=` returning `AgentRunHistory`
       (reuse existing `windowToQuery`); add `agentPerfQueryKeys.runs(agentId, window, page, limit)`.
    2. In `client/src/lib/hooks/agentPerformance.ts`: add `useAgentRuns(agentId, window, page,
       limit)` (`useQuery`, `enabled: !!agentId`, `staleTime: 60_000`, `keepPreviousData` for
       smooth paging), mirroring `useAgentStats`.
  - **Module:** client · **Type:** ui
  - **Skills to use:** react-best-practices, next-best-practices, typescript-expert
  - **Owned paths:** `client/src/lib/api.ts`, `client/src/lib/hooks/agentPerformance.ts`
  - **Depends-on:** T1
  - **Covers:** AC-5, AC-8, AC-12
  - **Known gotchas:** all API access must stay in `api.ts`; import `AgentRunHistory`/`RunHistoryRow`
    types from `@devdigest/shared`, never hand-duplicate. Query key must embed page+limit+window so
    paging/period changes refetch (matches the existing `stats` key pattern).
  - **Acceptance:** `cd client && npx tsc --noEmit` passes; hook + fetcher exported.
- **T5 — Presentational chart/table subcomponents**
  - **Action:** Create pure, prop-driven components under
    `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/_components/`:
    `Sparkline` (from `StatPoint[]`, oldest→newest, with an accessible numeric label — AC-1/AC-16
    flat/empty), `AcceptRateGauge` (radial ring from `accept_rate`; distinct empty state when null,
    never a 0% gauge, with text equivalent — AC-2), `CostDelta` ($ delta + % + direction colour
    green=cheaper/red=pricier, "—" when either avg is null — AC-3/AC-10), `SeverityStackedBars`
    (stacked C/W/S per bucket + legend + numeric equivalents; zero-height on empty — AC-6/AC-16),
    `CategoryDonut` (wraps existing `@/vendor/ui/charts/Donut` — map `cost_by_category` to
    `{label,value,color}`; empty state when no priced findings — AC-7/AC-16), `RunHistoryTable`
    (rows as props + `onViewTrace(row)` callback + pager props; PR cell links to
    `/repos/:repoId/pulls/:number` built from internal `pr_repo_id`/`pr_number`, `pr_title` rendered
    as inert escaped JSX text, "—" for null pr/cost/findings, View-trace disabled when
    `has_trace===false` — AC-8/AC-9/AC-10/AC-11/AC-17).
  - **Module:** client · **Type:** ui
  - **Skills to use:** react-best-practices, frontend-architecture, react-testing-library, security, typescript-expert
  - **Owned paths:**
    `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/_components/Sparkline.tsx`,
    `.../StatsTab/_components/AcceptRateGauge.tsx`,
    `.../StatsTab/_components/CostDelta.tsx`,
    `.../StatsTab/_components/SeverityStackedBars.tsx`,
    `.../StatsTab/_components/CategoryDonut.tsx`,
    `.../StatsTab/_components/RunHistoryTable.tsx`
  - **Depends-on:** T1
  - **Covers:** AC-1, AC-2, AC-3, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-16, AC-17
  - **Known gotchas:** these are presentational — no data fetching, no drawer state; they receive
    data + callbacks as props (drawer/paging wiring lives in T6). Reuse the existing `Donut`
    (`client/src/vendor/ui/charts/Donut.tsx`, `{label,value,color}[]`, `valuePrefix="$"`) — do not
    build a new donut. Every chart needs a text/numeric equivalent (WCAG 2.1 AA) — shape/colour
    alone fails A11y. PR title must never be used to build the link target (AC-17).
  - **Acceptance:** `cd client && npx tsc --noEmit` passes; components render in isolation
    (exercised by T6's `StatsTab.test.tsx`).
### Phase 4 — Client integration
- **T6 — StatsTab enrichment + wiring + i18n + tests**
  - **Action:**
    1. Enrich `StatsTab.tsx`: keep the existing four cards + period picker (AC-4); overlay
       `Sparkline` on TOTAL RUNS, `AcceptRateGauge` on ACCEPT RATE, `CostDelta` on AVG COST/RUN
       (compute % client-side from `avg_cost_usd` and `avg_cost_usd_prev`); replace the flat
       severity boxes with `SeverityStackedBars` (from `severity_by_bucket`); add `CategoryDonut`
       (from `cost_by_category`); add `RunHistoryTable` fed by `useAgentRuns` with local page state.
    2. Mount the existing default-export `RunTraceDrawer` from the repos/pulls path; hold
       `openRunId` state, open on `onViewTrace`, pass `{ runId, agentName: data.agent_name, onClose }`;
       drawer's own 404 handling covers the trace-deleted race (AC-11).
    3. Per-block loading (skeletons) and independent error states so one failed fetch keeps other
       loaded blocks (AC-14/AC-15); zero-run window renders empty states across all blocks (AC-16);
       all new blocks read the same `window` (AC-5).
    4. Add i18n keys under the `agents` namespace in `client/messages/en/agents.json` (new block
       titles, legend/column labels, empty/error strings) — no hardcoded strings.
    5. Extend `StatsTab.test.tsx`: enrich fixtures with the three new fields + a runs page; cover
       the happy path (all blocks render), null accept-rate gauge empty state, unpriced cost delta
       "—", a run row opening `RunTraceDrawer`, and the zero-run empty state.
  - **Module:** client · **Type:** ui
  - **Skills to use:** react-best-practices, next-best-practices, frontend-architecture, react-testing-library, typescript-expert, security
  - **Owned paths:**
    `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/StatsTab.tsx`,
    `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/StatsTab.test.tsx`,
    `client/messages/en/agents.json`
  - **Depends-on:** T4, T5
  - **Covers:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-8, AC-11, AC-14, AC-15, AC-16
  - **Known gotchas:** `StatsTab` is already `"use client"` — keep it; `RunTraceDrawer` is a default
    export and needs `useRunEvents`/`useRunTrace` (already client). Mock `useAgentStats`/`useAgentRuns`
    (or MSW) in the test; the existing zero-run guard (`data.runs === 0`) must still short-circuit to
    empty states. Do not re-fetch trace for the whole tab — the drawer loads it lazily by `runId`.
  - **Acceptance:** `cd client && npm test -- StatsTab` green; `cd client && npx tsc --noEmit` passes.

## Testing strategy
- **Server unit/integration** (T3): `cd server && npm test -- agent-performance` and
  `cd server && npm test -- routes` — bucketing/prev-window/cost-by-category pure logic, pagination
  clamp, window scoping, agent-ownership 404, `has_trace` gate.
- **Contract parse** (T1): `cd server && npm test -- contracts`.
- **Onion gate** (T2/T3): `cd server && npm run depcruise` must stay green; the module's
  no-`LLMProvider` grep gate must return nothing.
- **Typecheck**: `cd server && npx tsc --noEmit`; `cd client && npx tsc --noEmit`.
- **Client component/integration** (T6): `cd client && npm test -- StatsTab` (RTL + userEvent;
  mock hooks or MSW at the network boundary).

## Risks & mitigations
- **Vendored-copy drift** (server vs client `observability.ts`) → T1 acceptance requires an empty
  `diff` between the two files; both edited in the same task.
- **`cost_by_category` reconciliation** depends on the divisor decision → defaulted to join-derived
  count so `Σ per-category ≈ window total`; if the user picks the stored column, only T2 step 3 +
  T3 `sumCostByCategory` change.
- **Adaptive bucketing degenerating to 1 bar** for short windows → `SEVERITY_BUCKET_TARGET` + a
  minimum-bucket rule in `bucketSeverity`, unit-tested for 1d and 30d windows (AC-6).
- **Run History perf on all-statuses read** (no `status='done'` prefix) → leading `agent_id` still
  serves the index; page size capped at 100; spec accepts this. No new index/migration.
- **Generated runner bundle** holds a stale `AgentStats` schema → left untouched (build artifact);
  flagged so no one hand-edits it.
- **AskUserQuestion unavailable** → plan is DRAFT with two clearly-scoped defaults; neither changes
  the DAG, so the orchestrator can confirm and dispatch without a re-plan.

## Red-flags check
- [x] Every requirement maps to a task
- [x] Every AC-1..AC-17 is covered by at least one task's `Covers` (AC-4 → T6; AC-10/AC-17 → T5;
      AC-13 → T3; AC-14/AC-15 → T6; all others mapped above)
- [x] No specification was authored or edited — spec taken as input
- [x] Execution mode recorded (multi-agent, defaulted) and the plan is shaped for it (DAG + phases)
- [x] Dependencies form a DAG: T1 → {T2, T4, T5}; T2 → T3; {T4, T5} → T6 (no cycles)
- [x] (multi-agent) Concurrent tasks have non-overlapping Owned paths — wave B {T2,T4,T5} and
      wave C {T3,T6} share no file
- [x] Every Acceptance is measurable (named test filter, `tsc`, `depcruise`, `diff`)
- [x] Shared-contract edit is additive and explicitly called out (T1 + Architecture changes)
- [x] No AC prose restated — spec referenced by ID; observables paraphrased only where load-bearing
- [x] No task `Action` exceeds 9 numbered steps; no sub-5-minute sibling tasks left unmerged
- [x] Cross-cutting Owned paths grep-verified with `file:line` (contract at observability.ts:96;
      route at reviews/routes.ts:101; trace at reviews/routes.ts:121; barrels at index.ts:25)
- [x] No shared symbol deleted/narrowed — `AgentStats` widened with required fields; all constructors
      swept (helpers `toAgentStats`, its 3 unit call sites, server routes `.parse`, client fixtures)
      and assigned to T1/T3/T6; generated runner bundle flagged as untouched build artifact
- [x] New endpoint follows an existing convention (`GET /pulls/:id/runs` precedent) and is
      registered in the existing `agent-performance` plugin (no new module, no `modules/index.ts` edit)
