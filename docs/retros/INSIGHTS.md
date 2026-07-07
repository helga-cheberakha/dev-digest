# Insights — workflow orchestration (cross-run)

Durable, orchestration-level lessons from multi-agent workflow runs, captured by the
`workflow-retro` skill. One-off facts stay in the per-run `RETRO-*.md` files; only lessons that
should change how the NEXT run is orchestrated belong here. Append-only — supersede wrong entries
with a new dated note, never edit or delete.

## What Works

- **2026-07-07** — Revise a subagent's artifact by RESUMING it via `SendMessage` (context intact),
  not by respawning: spec-creator's clarification-resolution resume cost 4 tool uses / 42s vs its
  16 tool uses / 4m46s cold start. Applies to any agent whose artifact will take user-driven
  revisions. Evidence: `docs/retros/RETRO-2026-07-07-project-context-folder-spec.md` (agent-runs table).
- **2026-07-07** — Pre-verify grounding facts in the main session (grep the key files once) and
  pass them into every agent brief as "verified, don't re-derive" — both spec-creator and
  implementation-planner built on them without re-research, and the "zero reviewer-core changes"
  claim held through planning. Evidence: `docs/retros/RETRO-2026-07-07-project-context-folder-spec.md`.

## What Doesn't Work

- **2026-07-07 (onboarding)** — Wide batches don't buy wall-clock when one giant task owns the
  critical path: an 8-agent concurrent batch still yielded only 1.23× parallelism because the
  monolithic service-orchestrator task (13 plan steps, 37m) → routes → integration-tests chain
  serialized ~76 minutes. When a plan task's Action has 10+ numbered steps, split it (e.g.
  fact-collection vs generation orchestration) so its dependents start earlier. Evidence:
  `docs/retros/RETRO-2026-07-07-onboarding-generator.md` (agent-runs table, critical path).

- **2026-07-07** — Backgrounding the next-stage agent (planner) while the previous artifact (spec)
  can still be revised by the user: the spec moved 23→26 ACs mid-plan, forcing a mid-run delta
  message and risking plan/spec divergence. Sequence stages behind the user's review gate instead —
  this user gates every stage ("wait clarification", "I'll review first"); ask the
  gate-or-run-through question before the first spawn. Evidence:
  `docs/retros/RETRO-2026-07-07-project-context-folder-spec.md` (What was hard / User interventions).

## Codebase Patterns

## Tool & Library Notes

- **2026-07-07** — `AskUserQuestion` is NOT available inside subagents — a brief that tells
  spec-creator to "hold a clarification dialogue with the user" cannot work. Correct flow: the
  agent returns its question set + defensible defaults, the MAIN session runs `AskUserQuestion`,
  then the agent is resumed via `SendMessage` with the answers (resume cost ≈ 1 tool call vs a
  cold respawn). Evidence: `docs/retros/RETRO-2026-07-07-onboarding-generator.md` (What was hard).
- **2026-07-07** — Do not block on `TaskOutput` for a running local agent: on timeout it dumps the
  raw JSONL transcript into orchestrator context (thousands of junk tokens). Task-notifications
  arrive automatically on completion; if a status check is truly needed, use `block:false`.
  Evidence: `docs/retros/RETRO-2026-07-07-onboarding-generator.md`.

## Recurring Errors & Fixes

- **2026-07-07** — `git add -A` in a batch commit on a worktree shared with a PARALLEL session
  swept an unrelated untracked file into the commit (required an amend). When multiple sessions
  can touch the same branch, orchestrator commits must list explicit paths. Evidence:
  `docs/retros/RETRO-2026-07-07-onboarding-generator.md` (What was missed).

## Session Notes

## Open Questions
