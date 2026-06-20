# Insights — reviewer-core

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

- **2026-06-18** — `INJECTION_GUARD` in `src/prompt.ts` correctly blocks "test fixture / demo / not for production / ignore" severity downgrade attempts in any language. The clause is appended to every agent system prompt by `assemblePrompt`, so it applies on every review path (studio AND CI runner). Verified: the guard explicitly names the "test fixture / intentional / demo / fake / example" vocabulary and states it can never reduce severity. Evidence: `reviewer-core/src/prompt.ts:16–28`.

## What Doesn't Work

## Codebase Patterns

- **2026-06-18** — `repoMap` and `callers` context are wired into the review pipeline (`run-executor.ts:175–203`) and passed to `reviewPullRequest` when `agent.repoIntel !== false` (the default). Both are best-effort: if the repo hasn't been indexed by ast-grep/codeindex, `buildCallersDigest` / `buildRepoMapDigest` return undefined and the prompt sections are simply omitted. An unindexed repo is the most common cause of confident-but-wrong type-inference findings (reviewer sees only the diff, infers types from variable names). Index the repo first for meaningful callers/repoMap context. Evidence: `server/src/modules/reviews/run-executor.ts:169–203`.

- **2026-06-18** — The grounding gate (`src/grounding.ts`) runs after every review path and drops findings that can't be anchored to the diff. This means even if the model produces a type-inference false positive, it survives only if it also cites a real file:line in the diff — a second filter against hallucinated findings.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
