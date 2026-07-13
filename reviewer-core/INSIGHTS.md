# Insights — reviewer-core

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

- **2026-07-13** — `grounding.ts`'s `buildLineIndex` derives a hunk's coverage from `h.newLineNumbers` (falling back to `newStart..newStart+newLines-1` if empty) — a diff-derived eval/test fixture whose hunk is a no-op (equal old/new line counts, zero `+`/`-` lines) covers only the literal context-line range in the header, so any finding whose expected region sits past that range gets silently dropped by `rangeIntersects`, even when the finding is otherwise "correct". When authoring or debugging a diff-grounded fixture, run it through `parseUnifiedDiff` (`server/src/adapters/git/diff-parser.ts`) and check the hunk's `newLineNumbers` actually contains the fixture's expected line range — don't assume the hunk header's line-count claim matches reality. Evidence: `reviewer-core/src/grounding.ts` (`buildLineIndex`, `rangeIntersects`), caught via `server` eval case `missing-owner-guard` (see `server/INSIGHTS.md` 2026-07-13).

## Codebase Patterns

- **2026-06-14** — `reviewPullRequest` already returns `tokensIn`/`tokensOut`/`costUsd` in `ReviewOutcome` — consumers wanting cost should READ it from the outcome, not recompute (zero extra model calls). Cost is accumulated per chunk and goes `null` if ANY chunk lacked a cost (conservative). The OpenRouter provider prefers the real `usage.cost` and falls back to `estimateCost`. Evidence: `reviewer-core/src/review/run.ts:110,184`, `src/llm/openrouter.ts`.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
