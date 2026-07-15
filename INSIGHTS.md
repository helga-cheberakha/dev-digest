# Insights — DevDigest (root)

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

- **2026-07-15** — `scripts/dev.sh`'s old cleanup trap did a plain `kill "$SERVER_PID"` on the backgrounded `(cd server && pnpm dev) &` subshell. That does NOT reach the actual port-binding process: `pnpm dev` → `tsx watch` → node listener is a 3-deep chain, and a bash subshell does not forward signals to its children, so killing the subshell PID leaves the grandchild `tsx watch`/node listener orphaned and still bound to the port. Verified live: after `kill $SERVER_PID`, `lsof -iTCP:3101` still showed the node listener running. Fix: walk the tree leaves-first (`kill_tree`, same pattern as `scripts/e2e.sh`) instead of a flat kill. Evidence: `scripts/dev.sh` (`cleanup`, `kill_tree`).
- **2026-07-10** — An LLM-judged eval `practice` phrased as a negation ("does not instruct running X") false-FAILs even when the model's answer correctly said "do NOT do X" — the judge rubric requires PASS via a verbatim quote, but any quote near the topic necessarily contains the forbidden term "X", so the judge reads presence-of-term as failure regardless of the surrounding negation. Observed: a response saying "DO NOT run `npm run db:generate`" was scored FAILED with that exact sentence quoted as (mis-scored) evidence. Fix: phrase every judged practice as a positive assertion (e.g. "explicitly tells the user to skip/avoid running X"), never as an absence. Evidence: `evals/src/scoring/llm-judge.ts:14` (rubric), `evals/workflow/review-workflow.cases.ts` (column-rename case, before/after).
- **2026-07-10** — A workflow eval's `expectFilesRead: ["one/path.md"]` false-FAILs a run that consulted the repo's guidance via an equally-valid duplicate doc — e.g. `server/CLAUDE.md` and `server/AGENTS.md` carry byte-identical guidance sentences (`grep` confirmed), so a run that read only `AGENTS.md` gave the correct answer but failed the trace assertion outright before the judge ever ran. Fix: `expectFilesRead` entries can now be a `string[]` "any of" group instead of a single required path. Evidence: `evals/src/dsl/case.ts` (`fileGroupRead`/`fileGroupLabel`).

## Codebase Patterns

## Tool & Library Notes

- **2026-07-15** — `client/.env`'s `WEB_PORT` is dead config for the normal dev flow: `client/package.json`'s `dev` script hardcodes `next dev -p 3000`, so `pnpm dev` (and `scripts/dev.sh`, which calls it) always serves on :3000 regardless of `WEB_PORT`. `scripts/e2e.sh` gets a different port only because it bypasses that script entirely and calls `pnpm exec next dev -p "$WEB_PORT"` directly. Evidence: `client/package.json:6` (`dev` script), `scripts/e2e.sh:148`.

## Recurring Errors & Fixes

- **2026-07-15** — Client shows "Cannot reach the DevDigest engine at http://localhost:3101. Is the API running?" right after `./scripts/dev.sh` — even though the script printed "starting API on :3001" and appeared to succeed. Cause: `server/.env`'s `API_PORT` can be repointed to 3101 (to match `scripts/e2e.sh`'s alt-port scheme) while `scripts/dev.sh` still hardcoded `kill_port 3001` — so a stale/orphaned listener from a prior Ctrl-C'd session (see the `kill_tree` entry in What Doesn't Work) was never reclaimed on port 3101, and the new `tsx watch` failed to bind. Fix: `scripts/dev.sh` now reads `API_PORT` out of `server/.env` (`API_PORT="$(grep -m1 '^API_PORT=' server/.env | cut -d= -f2)"`, default 3001) and uses it for both the log line and `kill_port`. Evidence: `scripts/dev.sh` (`API_PORT` derivation).

## Session Notes

## Open Questions
