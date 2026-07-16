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

- **2026-07-16** — The OpenAI SDK's own `maxRetries` (passed to `new OpenAI({maxRetries})`) only retries network failures and non-2xx statuses inside `makeRequest` — a 200 OK with a truncated/empty body fails LATER when the caller awaits the response and the SDK lazily calls `response.json()` in `APIPromise`'s `.then()`, by which point the SDK's retry loop has already exited "successfully". Surfaces as `TypeError: invalid json response body at <url> reason: Unexpected end of JSON input` (undici's fetch) straight out of `chat.completions.create()`, uncaught by the SDK and unretried. Real incident: OpenRouter/upstream model cut a response short mid-CI-run, hard-failing one agent's whole review while sibling agents on the same PR succeeded. Fixed with `withBodyParseRetry` — a small wrapper matching only `/invalid json response body/i` (never blanket-retries auth/schema/other errors) around the `create()` call, 2 retries with linear backoff. Evidence: `reviewer-core/src/llm/openrouter.ts` (`isTransientBodyParseError`, `withBodyParseRetry`), `reviewer-core/src/llm/openrouter.test.ts`.

## Session Notes

## Open Questions
