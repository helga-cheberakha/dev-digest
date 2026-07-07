---
name: workflow-retro
description: >
  Captures a retrospective of a multi-agent workflow run (spec-creator → implementation-planner →
  /implement, or any session that spawned 2+ agents): per-agent token/tool/duration metrics from the
  spawn usage blocks, launch order and parallelism, and orchestration insights — what was hard, what
  was easy, what information was duplicated, what was missed. Writes one report per run to
  docs/retros/ and appends durable orchestration lessons to docs/retros/INSIGHTS.md (append-only).
  MANUAL ONLY — never auto-run after a workflow. TRIGGER only when the user explicitly invokes
  /workflow-retro or explicitly asks for a workflow retro ("retro the run", "workflow retro").
  Does NOT cover: module-level code insights (use engineering-insights), reviewing code
  (architecture-reviewer), or verifying plan completion (plan-verifier).
---

# /workflow-retro — multi-agent run retrospective

Capture **how the orchestration went**, not what the code does. The unit of analysis is the
workflow run: which agents ran, in what order, at what cost, and what the orchestrator would do
differently next time. Module-level engineering findings still go through `engineering-insights` —
never duplicate them here.

## When to run

- **Only on explicit user invocation** (`/workflow-retro` or a direct request for a retro). Never
  run automatically after a workflow finishes, and never suggest-and-run in one move — finishing
  /implement is NOT a trigger.
- Precondition: the session spawned **2+ agents** and the workflow's final report exists (e.g.
  /implement Step 4) — never mid-run.
- Even when invoked: skip (write nothing) if fewer than 2 agents ran or the run was trivially
  short — the gate is the same "substantial or silent" rule as engineering-insights.

## Data sources (all already in your context — zero new agent spawns, zero LLM calls)

| Metric | Where it comes from |
|---|---|
| Per-agent tokens / tool uses / duration | the `<usage>` block in each Agent spawn result and task-notification (`subagent_tokens`, `tool_uses`, `duration_ms`) |
| Launch order, sync vs background, batches | the order and grouping of your own `Agent` calls |
| Resumptions | `SendMessage` calls to an existing agentId (count per agent) |
| Fix-loop iterations, commits | the /implement transcript and `git log` |
| User interventions | user messages that corrected course mid-run (interruptions, added requirements, gate answers) |
| Main-session tokens | not directly observable — record subagent totals and mark the main session `n/a` unless the harness surfaced a figure |

Do not guess numbers. A metric you cannot ground in a usage block or transcript fact is written as
`n/a`, not estimated.

## Where to write

1. **Per-run report:** `docs/retros/RETRO-YYYY-MM-DD-<workflow-slug>.md` (new file per run; slug =
   the feature or plan name, e.g. `RETRO-2026-07-07-project-context-folder.md`).
2. **Durable lessons:** append to `docs/retros/INSIGHTS.md` under its fixed sections (create the
   file with the section skeleton on first use). Same hard rules as engineering-insights:
   **read first, dedup, append-only via anchored Edit — never `Write` over an existing file**,
   supersede wrong entries with a new dated note instead of editing them.

Only cross-run, orchestration-level lessons go into `INSIGHTS.md` ("backgrounding the planner while
the spec is still being revised forces a mid-run delta message — sequence them instead"). One-off
facts stay in the per-run report.

## Per-run report template (fixed)

```markdown
# Retro — <workflow name>   |   YYYY-MM-DD   |   branch: <branch>

## Run metadata
- Workflow: <spec→plan→implement | /implement | other>
- Artifacts: <spec path, plan path, PR/commits>
- Outcome: <shipped / partially shipped / aborted> — <one line>

## Agent runs (in launch order)
| # | Agent | Mode | Resumed | Tokens | Tool uses | Duration | Batch |
|---|-------|------|---------|--------|-----------|----------|-------|
| 1 | spec-creator | sync | 2× | 103,541 + … | 16 | 4m46s | — |

- **Totals:** N agents, M resumptions, Σ tokens, Σ duration (wall-clock vs Σ agent time = parallelism gain)
- **Order & parallelism:** <which batches ran concurrently, which serialized, and why>

## What was hard
- <friction points: blocked tasks, retries, stuck loops, unclear contracts between agents>

## What was easy / worked well
- <things that went first-pass green; reusable orchestration moves>

## Duplicated information
- <same files read by multiple agents; context re-briefed that an earlier result already contained;
  overlapping research>

## What was missed
- <gaps caught late: spec holes found at planning time, plan holes found at implement time,
  requirements added mid-run by the user>

## User interventions
- <each mid-run correction and what it changed>

## Next-time adjustments
- <concrete changes to briefs, sequencing, or agent definitions — each actionable cold>
```

## Workflow

```
- [ ] 1. Gate check — 2+ agents and a substantial run?
- [ ] 2. Collect metrics from usage blocks / transcript (no guessing)
- [ ] 3. Write docs/retros/RETRO-<date>-<slug>.md from the template
- [ ] 4. Read docs/retros/INSIGHTS.md, draft ≤3 durable lessons, dedup
- [ ] 5. Append survivors (append-only)
- [ ] 6. One-line summary to the user
```

## Non-destructive write contract (hard rule)

Identical to engineering-insights: `docs/retros/INSIGHTS.md` is append-only; re-read immediately
before writing; anchored `Edit` inserts under the right heading; never overwrite, never delete,
supersede with dated notes; idempotent on duplicates. Per-run RETRO files are write-once — if a
retro for this run already exists, update it with `Edit`, don't create a second one.
