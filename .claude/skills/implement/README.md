# Implement Skill

Implementation Plan executor for the DevDigest project. One command takes an **already-approved**
plan and drives it to reviewed code — dispatching the implementer/reviewer agents, keeping its own
context lean (only short agent reports), and resolving review comments in a bounded fix loop.

Spec authoring (`spec-creator`) and planning (`implementation-planner`) are run **separately and
manually** beforehand. This command starts from the plan.

## What it does

Runs in the main session as the **orchestrator**. It never implements or reviews itself — it spawns
the agents, runs independent ones concurrently, and resolves architecture-review + traceability
comments through a bounded fix loop. It never pushes or merges.

```
args: plan:<path>  [mode:multi|single]  [max-fix:N]
  └─ read plan (tasks · DAG · owned paths · execution mode)
       └─ implementer ×N   (multi-agent by DAG / non-overlapping owned paths, or single-agent;
            routed by task Type: backend|core → implementer-backend, ui|e2e → implementer-ui)
            └─ architecture-reviewer ‖ plan-verifier   (parallel, read-only, Sonnet)
                 └─ fix loop ×≤max-fix   (implementer fixes CRITICAL/HIGH + VIOLATIONs → re-review changed files)
                      └─ final report (incl. per-agent usage)  +  "run pr-self-review before push"
```

## When to invoke

- `/implement plan:docs/plans/<feature>.md` (optionally `mode:single`, `max-fix:2`)
- Phrases: "run the plan", "execute the plan", "implement docs/plans/<x>.md".

## Inputs

| Token | Meaning | Default |
|-------|---------|---------|
| `plan:<path>` | Approved Implementation Plan. **Required.** | — |
| free-text prose | Notes/constraints for this run | — |
| `mode:multi` / `mode:single` | Override the plan's Execution mode | read from plan |
| `max-fix:<n>` | Cap on the fix loop | `3` |

## Agents orchestrated

| Stage | Agent | Model | Role |
|-------|-------|-------|------|
| Build | `implementer-backend` / `implementer-ui` / `implementer` ×N | sonnet | One task each, routed by task Type; parallel by non-overlapping owned paths; self-verifies |
| Review | `architecture-reviewer` | sonnet | Structural contracts (read-only) |
| Review | `plan-verifier` | sonnet | Requirement traceability / completeness (read-only) |
| Fix | matching implementer profile ×N | sonnet | Resolve CRITICAL/HIGH findings + VIOLATIONs (DRIFT and uncovered ACs go to a human) |

**Not invoked here:** `spec-creator`, `implementation-planner` (run manually beforehand), and
`test-writer` (dedicated test authoring is intentionally disabled to save tokens — coverage comes
from each implementer's self-verification).

## Guardrails

- Starts from a plan — never authors a spec or a plan.
- Never `git push`, merge, or open a PR — ends with a recommendation to run `pr-self-review`.
- Fix loop is bounded by `max-fix`; remaining findings are reported for a human, never looped forever.
- Concurrent implementers must own non-overlapping paths.
- Orchestrator keeps only short agent reports in context — heavy work stays isolated per agent.

## File structure

```
implement/
├── SKILL.md     ← orchestrator — phased execution algorithm + bounded fix loop
├── tile.json    ← skill metadata
└── README.md    ← this file
```

## Relationship to `pr-self-review`

`/implement` builds and reviews a feature **before** push (deep structural + traceability gate via
the dedicated agents). `pr-self-review` is the **broad pre-push gate** (security, npm audit, contract
sync, test-coverage, react/next checks) that runs at `git push`. Run `/implement` to build the
feature, then `pr-self-review` as the final gate before pushing.
