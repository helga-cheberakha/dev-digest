# Insights — e2e

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-07-07** — `run.ts` `loadFlows()` discovers ONLY files matching `*.flow.json` in `e2e/specs/` (existing convention: `NN-name.flow.json`). A spec file named without the `.flow.json` suffix is silently never executed — the runner still reports "N/N flows passed" with no error. When adding a flow, match the glob and the `NN-` numbering, and eyeball the runner's flow count once. Evidence: `e2e/run.ts` (`loadFlows`), `e2e/specs/08-brief-review-focus-click.flow.json`.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
