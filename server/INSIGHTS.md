# Insights — server

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-06-18** — `repository.ts` in `server/src/modules/reviews/` is a class wrapper around `run.repo.ts` functions and has its own mirrored method signatures — when changing a function's parameter shape in `run.repo.ts`, update the wrapper in `repository.ts` too or the server build breaks. Evidence: `server/src/modules/reviews/repository.ts:151`.
- **2026-06-18** — PR list aggregation pattern is IN-query + JS-grouping, not SQL GROUP BY — query the child table with `inArray(parentId, prIds)`, collect rows, group in memory. Score, cost, and findings all follow this same pattern in `server/src/modules/pulls/routes.ts`. Consistent; avoids complex SQL.

- **2026-06-18** — `rollupSeverities()` at `server/src/modules/pulls/status.ts:23` is a reusable helper that takes `{ severity: string }[]` and returns `{ critical, warning, suggestion }` counts. Use it for any new per-severity breakdown rather than writing inline tallying. Also exports the `SeverityCounts` interface.

- **2026-06-18** — Seed `ReviewRecord.run_id` is `null` — seeded reviews have no `run_id`, so any run→review match via `reviews.find(rv => rv.run_id === r.run_id)` always misses on seed data. Real reviews created through the app set `run_id` at completion in `run-executor.ts`. Expected, not a bug.

- **2026-06-18** — PR list cost uses a 120-second batch window (not `SUM`): rows ordered newest-first, first priced run anchors the window, subsequent runs within 2 min accumulate — this groups "run all agents" clicks into one cost figure per PR. Evidence: `server/src/modules/pulls/routes.ts`.

- **2026-06-18** — `findings_counts` in `PrMeta` (PR list column) aggregates across ALL reviews of a PR (minus dismissed), while `score` reflects only the latest review. A multi-review PR can therefore show a severity badge count that doesn't match any single run's per-run badge. The per-run badge in `RunHistory` uses `reviews.find(rv => rv.run_id === r.run_id)` which matches nothing on seed data (seeded `run_id` is null). Evidence: `server/src/modules/pulls/routes.ts` aggregation block.

## Tool & Library Notes

- **2026-06-18** — Drizzle ORM: use `isNull(column)` (imported from `drizzle-orm`) to filter for null column values in WHERE clauses. `eq(column, null)` does not work. Evidence: `server/src/modules/pulls/routes.ts` findings aggregation block.

## Recurring Errors & Fixes

## Session Notes

### 2026-06-18

Lab 01 cost column: added `cost_usd double precision` back to `agent_runs` (dropped in migration 0009 as a course exercise). Wired `outcome.costUsd` through `run-executor.ts → completeAgentRun → listRunsForPull` and into `RunTrace.stats`. Added batch-window aggregation to the PR list query. Client: new `RunCostBadge` component (2 variants) and `formatCost` utility.

### 2026-06-18

Findings column feature: added `findings_counts: { critical, warning, suggestion }` to `PrMeta` (both vendor copies). Server: new findings aggregation block in `GET /repos/:id/pulls` using `inArray` + JS-grouping + `rollupSeverities()`, filtering out dismissed findings via `isNull(t.findings.dismissedAt)`.

## Open Questions
