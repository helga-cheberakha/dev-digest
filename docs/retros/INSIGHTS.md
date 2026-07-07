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

- **2026-07-07** — Backgrounding the next-stage agent (planner) while the previous artifact (spec)
  can still be revised by the user: the spec moved 23→26 ACs mid-plan, forcing a mid-run delta
  message and risking plan/spec divergence. Sequence stages behind the user's review gate instead —
  this user gates every stage ("wait clarification", "I'll review first"); ask the
  gate-or-run-through question before the first spawn. Evidence:
  `docs/retros/RETRO-2026-07-07-project-context-folder-spec.md` (What was hard / User interventions).

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
