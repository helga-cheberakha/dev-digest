# Insights — DevDigest (root)

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

- **2026-07-10** — An LLM-judged eval `practice` phrased as a negation ("does not instruct running X") false-FAILs even when the model's answer correctly said "do NOT do X" — the judge rubric requires PASS via a verbatim quote, but any quote near the topic necessarily contains the forbidden term "X", so the judge reads presence-of-term as failure regardless of the surrounding negation. Observed: a response saying "DO NOT run `npm run db:generate`" was scored FAILED with that exact sentence quoted as (mis-scored) evidence. Fix: phrase every judged practice as a positive assertion (e.g. "explicitly tells the user to skip/avoid running X"), never as an absence. Evidence: `evals/src/scoring/llm-judge.ts:14` (rubric), `evals/workflow/review-workflow.cases.ts` (column-rename case, before/after).
- **2026-07-10** — A workflow eval's `expectFilesRead: ["one/path.md"]` false-FAILs a run that consulted the repo's guidance via an equally-valid duplicate doc — e.g. `server/CLAUDE.md` and `server/AGENTS.md` carry byte-identical guidance sentences (`grep` confirmed), so a run that read only `AGENTS.md` gave the correct answer but failed the trace assertion outright before the judge ever ran. Fix: `expectFilesRead` entries can now be a `string[]` "any of" group instead of a single required path. Evidence: `evals/src/dsl/case.ts` (`fileGroupRead`/`fileGroupLabel`).

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
