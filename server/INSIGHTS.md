# Insights — server

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-06-18** — `repository.ts` in `server/src/modules/reviews/` is a class wrapper around `run.repo.ts` functions and has its own mirrored method signatures — when changing a function's parameter shape in `run.repo.ts`, update the wrapper in `repository.ts` too or the server build breaks. Evidence: `server/src/modules/reviews/repository.ts:151`.
- **2026-06-18** — PR list cost uses a 120-second batch window (not `SUM`): rows ordered newest-first, first priced run anchors the window, subsequent runs within 2 min accumulate — this groups "run all agents" clicks into one cost figure per PR. Evidence: `server/src/modules/pulls/routes.ts`.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

### 2026-06-18

Lab 01 cost column: added `cost_usd double precision` back to `agent_runs` (dropped in migration 0009 as a course exercise). Wired `outcome.costUsd` through `run-executor.ts → completeAgentRun → listRunsForPull` and into `RunTrace.stats`. Added batch-window aggregation to the PR list query. Client: new `RunCostBadge` component (2 variants) and `formatCost` utility.

## Open Questions
