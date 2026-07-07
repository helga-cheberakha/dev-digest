---
name: implement
description: >
  Runs an already-approved DevDigest Implementation Plan end-to-end: dispatches implementer agents
  per the plan's DAG (multi-agent by non-overlapping owned paths, or single-agent), then gates with
  architecture-reviewer + plan-verifier in parallel, then resolves their comments in a bounded fix
  loop. Starts FROM a plan — spec authoring (spec-creator) and planning (implementation-planner) are
  run separately/manually beforehand. Never pushes or merges.
  TRIGGER when: "/implement", "run the plan", "execute the plan", "implement this plan",
  "implement docs/plans/<x>.md", "/implement plan:<path>".
  Does NOT cover: writing specs, writing the plan, authoring tests (test-writer is not invoked here),
  pushing/merging (run pr-self-review before push).
---

# /implement — Implementation Plan executor

> **Take an approved Implementation Plan and drive it to reviewed code: implement per the DAG, gate
> with architecture-reviewer + plan-verifier, and resolve their comments in a bounded fix loop.**

You are the **orchestrator**, running in the main session. The spec and the plan already exist and
were approved by a human beforehand (you run `spec-creator` and `implementation-planner` separately —
they are **not** part of this command). You do **not** implement or review yourself — you dispatch the
specialized agents and keep only their short final reports in context, so your context stays lean and
cheap. Spawn agents with the `Agent` tool; run independent agents **concurrently** (multiple tool
calls in one message).

## Inputs (args)

| Token                        | Meaning                                                                  | Default            |
|------------------------------|--------------------------------------------------------------------------|--------------------|
| `plan:<path>`                | Path to the approved Implementation Plan. **Required.**                  | —                  |
| free-text prose              | Optional notes / constraints for this run (e.g. "skip phase 3 for now"). | —                  |
| `mode:multi` / `mode:single` | Override the plan's Execution mode.                                      | read from the plan |
| `max-fix:<n>`                | Cap on the architecture-review fix loop (Step 3).                        | `3`                |

If no `plan:` is given, ask for the plan path and stop — do not guess. State your interpretation of
the args in one line before starting.

## Guardrails (always)

- **Starts from a plan.** Do not author a spec or a plan here. If the plan is missing or unreadable,
  stop and say so.
- **No test-writer.** A dedicated test-authoring pass is intentionally disabled for this command.
  Coverage comes only from each implementer's self-verification (the module's existing tests +
  typecheck). Do not spawn `test-writer`.
- **Never `git push`, merge, or open a PR.** The run ends at a review-clean working tree plus a
  recommendation to run `pr-self-review`.
- **Commit after every batch/phase and every fix iteration** (commits yes — push no). The message
  carries the task IDs: `[PLAN-<feature>] Phase <N>: T1, T2`. Without these commits the review
  gate is blind: architecture-reviewer's default scope is `git diff main...HEAD` (committed work
  only — an uncommitted tree reads as an empty diff and the reviewer stops), and plan-verifier's
  #1 evidence signal is exactly these commit messages.
- **Bound the fix loop** to `max-fix` iterations. Never loop forever; if findings remain, stop and
  report them for a human.
- **Respect owned-path non-overlap** whenever you run implementers concurrently.
- **Keep context lean.** Hold the plan path and each agent's short report — never paste an agent's
  full working transcript back into your own reasoning.

## Execution algorithm

### Step 0 — Read the plan

Read the plan file. Extract for every task: `T-id`, `Action`, `Module`, `Type`, `Skills to use`,
`Owned paths`, `Depends-on`, `Known gotchas`, `Acceptance`. Read the plan's `## Execution mode`
field; a `mode:` arg overrides it. Build the dependency DAG from `Depends-on`. Print a one-line
summary of what will run (e.g. "6 tasks, multi-agent, 3 phases; fix loop max 3").

### Step 1 — Implement

**Multi-agent mode** (default when the plan says so):
1. Find the **ready set** — tasks whose `Depends-on` are all complete and whose `Owned paths` do not
   overlap any task already running this batch.
2. Spawn one implementer per ready task, **concurrently** (one message, multiple `Agent` calls),
   **routed by the task's `Type`**:

   | Task `Type` | Agent to spawn |
   |---|---|
   | `backend` \| `core` | `implementer-backend` |
   | `ui` \| `e2e` | `implementer-ui` |
   | spans both | `implementer` (generic) |

   Give each one the **plan path + its task ID** (its contract is to read its own task from the
   plan file), any run notes from the args, **plus the list of the other tasks' `Owned paths`** so
   it stays in its lane.
3. Wait for the batch, collect reports, mark tasks done.
4. **Commit the batch**: `[PLAN-<feature>] Phase <N>: <T-ids> — <one line>` (see Guardrails — the
   review gate reads committed work only).
5. Repeat from (1) until all tasks are complete.

**Single-agent mode:** run the tasks sequentially in plan order, one implementer at a time (same
`Type` routing), committing after each phase.

Each implementer self-verifies (the module's existing tests + typecheck) before returning. If one
reports **blocked / failing** and cannot fix it in scope: record it, and either dispatch a targeted
retry or surface it to the user — do not silently continue past a red task that others depend on.

### Step 2 — Review gate (parallel, read-only)

Compute the **changed-file set** (`git diff` against `origin/main`, or accumulate from the implementer
reports). Then spawn, **concurrently**:

- **`architecture-reviewer`** on the changed-file set → a Concern Matrix + findings with
  severities. There is no literal PASS/FAIL line in its report: treat **PASS = zero
  CRITICAL/HIGH findings**, FAIL otherwise.
- **`plan-verifier`** with the plan + changed set → per-task classifications
  (**COMPLETE / DRIFT / VIOLATION**), a spec-AC coverage check (`uncovered_acs`), and a
  **PASS / FAIL / REVIEW NEEDED** verdict.

Both run on Sonnet (read-only, structured prompts). Collect both verdicts.

### Step 3 — Fix loop (bounded — this is where review comments get resolved)

Build the **fix backlog**:
- `architecture-reviewer` findings with severity **CRITICAL** or **HIGH** (MEDIUM/LOW → report only).
- `plan-verifier` tasks classified **VIOLATION** (a required artifact does not exist — hard fail).

**Never auto-fix the rest of the verifier's output:**
- **DRIFT** → a human decision by the verifier's own contract. List the drift items, ask the user
  to accept or revert each; accepted → done, revert → becomes a fix task.
- **Uncovered ACs** (`uncovered_acs`) → a planning gap, not an implementation bug. Report it for
  the user / a re-planning pass — do not invent tasks for it.

If the backlog is empty → go to Step 4. Otherwise loop, for iteration `i = 1 … max-fix`:

1. **Group** findings by file / owned-path into non-overlapping fix tasks.
2. **Dispatch implementer(s)** — one per group, concurrent where owned paths are disjoint, routed
   by the touched files' module (`server/`, `reviewer-core/` → `implementer-backend`; `client/`,
   `e2e/` → `implementer-ui`; mixed → generic `implementer`) — each instructed: *"Fix exactly
   these findings in these files, stay in scope, self-verify."* Pass each finding's text,
   `file:line`, and the reviewer's recommendation.
3. Each fix implementer self-verifies (existing tests + typecheck).
4. **Commit the iteration**: `[PLAN-<feature>] review fixes (<i>): <one line>` — so the re-review
   sees the fixes in the diff.
5. **Re-review only the changed files**: re-run `architecture-reviewer` scoped to the touched files;
   re-run `plan-verifier` only for the tasks that were VIOLATION.
6. Recompute the backlog:
    - empty → **break (gate PASS)**.
    - non-empty but **no progress** since last iteration (same findings unresolved) → break and flag as
      stuck for the user.
    - otherwise → continue to the next iteration.

If `max-fix` is reached with a non-empty backlog → stop and list the remaining findings for a human
decision. Never exceed the cap.

### Step 4 — Final report

Output the summary below and recommend running **`pr-self-review`** before push. Do **not** push,
merge, or open a PR. Offer to invoke `pr-self-review` as the next step.

## Output format (final report)

```
## /implement — <feature>

- **Plan:** `docs/plans/PLAN-<feature>.md` — mode: multi-agent | single-agent
- **Implemented:** <N> tasks (T1…Tn) — <one line>
- **Commits:** <list of `[PLAN-<feature>] …` commits made this run>
- **Self-verify:** module suites + typecheck green | failing (<detail>)

### Review gate
- architecture-reviewer (sonnet): PASS (0 CRITICAL/HIGH) | FAIL — <CRITICAL/HIGH counts; MEDIUM/LOW recorded>
- plan-verifier (sonnet): PASS | FAIL | REVIEW NEEDED — <COMPLETE N/M; VIOLATIONs; DRIFTs awaiting decision; uncovered ACs>

### Fix loop
- iterations run: <i> / <max-fix>
- resolved: <findings fixed>
- **remaining (needs human):** <list, or "none">

### Next step
Run `pr-self-review` before pushing. (Not pushed — by design.)
```

## When you cannot proceed

If `plan:` is missing or the plan is unreadable, or an implementer is blocked on something only a
human can decide — stop and say plainly what you need. A clear "blocked here, need X" is a valid
result; a half-run pretending to be complete is not.
