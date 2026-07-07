---
name: workflow-retro
description: >
  Captures a retrospective of a multi-agent workflow run (spec-creator → implementation-planner →
  /implement, or any session that spawned 2+ agents): per-agent token/tool/duration metrics from the
  spawn usage blocks — or, in `deep` mode, exact tokens, cache hit ratio, and nested-sub-agent
  accounting parsed from the on-disk JSONL journals — plus launch order, parallelism, and
  orchestration insights: what was hard, what was easy, what information was duplicated, what was
  missed. Writes one report per run to docs/retros/, appends one trend row to docs/retros/ledger.md,
  and appends durable orchestration lessons to docs/retros/INSIGHTS.md (append-only).
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

## Inputs (args)

| Token | Meaning | Default |
|---|---|---|
| `label:<slug>` | Name for this retro (the run under review). | derived from the plan/feature or date |
| `deep` | Parse the on-disk JSONL journals for exact token / cache / tool / timing data. | off (in-context metrics only) |
| `session:<id>` | Which session transcript to analyse in `deep` mode. | the current session |
| `scope:last` / `scope:session` | Review just the most recent agent batch, or every agent in the session. | `last` |
| `no-ledger` | Write the report only; skip the ledger trend row. | off (ledger row is written) |

If it is ambiguous *which* run to review (several distinct batches in one session), ask before
analysing — do not silently pick.

## Count nested sub-agents (do not undercount)

A sub-agent can spawn its **own** sub-agents (e.g. `spec-creator` and `implementation-planner`
hold the `Agent` tool and fan out `researcher`s). These **nested** agents consume real tokens and
tool calls and **must be included** in the per-agent breakdown and in every total.

- **They are easy to miss in-context.** A parent agent's `<usage>` block reports only the parent's
  own tokens — it does **not** include its children's. So the in-context view of a run that used a
  spawning agent **undercounts** the real cost (a run can look like "1 agent / ~75k" but really be
  5 agents — a `spec-creator` plus 4 nested `researcher`s — at a far higher true total).
- **Deep mode catches them.** Journals are stored **flat** in `subagents/`, so a plain
  `agent-*.jsonl` glob already includes every nesting level. Each journal has a sibling
  `<journal>.meta.json` with `agentType`, `description`, and **`spawnDepth`** (1 = spawned by the
  main session, > 1 = nested). The helper reads these, indents nested agents under their depth,
  and **sums all depths into the total**.
- **Rule:** whenever the run used an agent that can spawn sub-agents — or you simply are not
  sure — prefer `deep`, or at minimum state in the report that the in-context totals exclude
  nested agents.

## Data sources (prefer the cheap one)

**1. In-context (default — zero new agent spawns, zero LLM calls, zero file reads):**

| Metric | Where it comes from |
|---|---|
| Per-agent tokens / tool uses / duration | the `<usage>` block in each Agent spawn result and task-notification (`subagent_tokens`, `tool_uses`, `duration_ms`) |
| Launch order, sync vs background, batches | the order and grouping of your own `Agent` calls |
| Resumptions | `SendMessage` calls to an existing agentId (count per agent) |
| Fix-loop iterations, commits | the /implement transcript and `git log` |
| User interventions | user messages that corrected course mid-run (interruptions, added requirements, gate answers) |
| Main-session tokens | not directly observable — record subagent totals and mark the main session `n/a` unless the harness surfaced a figure |

**2. Deep (the `deep` flag) — exact, per-turn numbers** (input / output / **cache-read** /
cache-creation tokens, tool-call counts, timestamps) parsed from the JSONL journals:

- Subagent journals: `~/.claude/projects/<project-slug>/<session-id>/subagents/agent-*.jsonl`
- Main session transcript: `~/.claude/projects/<project-slug>/<session-id>.jsonl`
- Run the bundled helper (read-only, stdlib-only):
  ```
  python3 .claude/skills/workflow-retro/scripts/analyze_journals.py \
    "~/.claude/projects/<project-slug>/<session-id>/subagents/agent-*.jsonl" --json
  ```
- It prints per-agent and total tokens, **cache hit ratio**, tool calls, wall-clock span, and a
  **parallelism factor** (Σ agent spans ÷ wall-clock). Nested sub-agents (spawnDepth > 1) are
  indented under their parent and **included in the totals** (the summary reports `nested=` and
  `max_depth=`). For a cost estimate pass `--prices prices.json`; **do not hard-code prices —
  confirm current per-model rates via the `claude-api` skill first**, since they drift.

Find the project slug / session id from the symlink targets under the session's `tasks/`
directory, or by matching the most recently modified `*.jsonl` under
`~/.claude/projects/<project-slug>/`.

Do not guess numbers. A metric you cannot ground in a usage block, a journal, or a transcript
fact is written as `n/a`, not estimated.

## What to watch for (cost levers)

- **Cache efficiency** = cache-read ÷ total input-side tokens (deep mode only). A low ratio means
  something is breaking the prompt cache — the single biggest cost lever. Typical causes: a
  dynamic block injected before the stable prompt prefix, or long gaps (> 5 min) between turns.
- **Cost per useful output** — $/spec, $/fixed-task, $/finding — a better signal than raw spend.
- **Critical path** — the single agent that dominated wall-clock.
- **Duplicated context** — the same large file read by multiple agents → candidate for one shared
  pre-read passed as an excerpt in the dispatch brief.

## Where to write

1. **Per-run report:** `docs/retros/RETRO-YYYY-MM-DD-<workflow-slug>.md` (new file per run; slug =
   the feature or plan name, e.g. `RETRO-2026-07-07-project-context-folder.md`).
2. **Trend row:** append one row to `docs/retros/ledger.md` (create the file with the header on
   first use; skip when `no-ledger`). One row per retro so runs can be compared over time:

   ```
   | date | label | agents (nested) | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
   |------|-------|-----------------|------------|-----------|------|-------------|------|--------------------|
   ```

   Columns without data (in-context mode has no cache hit / cost) get `n/a`.
3. **Durable lessons:** append to `docs/retros/INSIGHTS.md` under its fixed sections (create the
   file with the section skeleton on first use). Same hard rules as engineering-insights:
   **read first, dedup, append-only via anchored Edit — never `Write` over an existing file**,
   supersede wrong entries with a new dated note instead of editing them.

Only cross-run, orchestration-level lessons go into `INSIGHTS.md` ("backgrounding the planner while
the spec is still being revised forces a mid-run delta message — sequence them instead"). One-off
facts stay in the per-run report.

## Per-run report template (fixed)

```markdown
# Retro — <workflow name>   |   YYYY-MM-DD   |   branch: <branch>   |   data: <in-context | deep>

## Run metadata
- Workflow: <spec→plan→implement | /implement | other>
- Artifacts: <spec path, plan path, PR/commits>
- Outcome: <shipped / partially shipped / aborted> — <one line>

## Agent runs (in launch order; └ = nested sub-agent)
| # | Agent | Mode | Resumed | Tokens (in/out) | Cache hit | Tool uses | Duration | Batch |
|---|-------|------|---------|-----------------|-----------|-----------|----------|-------|
| 1 | spec-creator | sync | 2× | 103,541 / 8,210 | 72% | 16 | 4m46s | — |
| 2 | └ researcher | nested | — | 41,002 / 3,115 | n/a | 9 | 1m52s | — |

- **Totals:** N agents (M nested, max depth D), R resumptions, Σ in/out tokens,
  cache hit <…%|n/a>, Σ duration, wall-clock, parallelism <Σ spans ÷ wall>x, cost <$|n/a>
- **Critical path:** <agent> (<span>)
- **Order & parallelism:** <which batches ran concurrently, which serialized, and why>
- (in-context mode: state explicitly that totals EXCLUDE nested sub-agents)

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
- <concrete changes to briefs, sequencing, concurrency, or agent definitions — each actionable
  cold; name the agent/file/parameter and the expected effect (tokens saved, round-trips avoided,
  wall-clock cut)>
```

## Workflow

```
- [ ] 1. Gate check — 2+ agents and a substantial run?
- [ ] 2. Collect metrics — in-context usage blocks; if `deep`, locate journals and run
        scripts/analyze_journals.py (nested agents included in totals)
- [ ] 3. Write docs/retros/RETRO-<date>-<slug>.md from the template
- [ ] 4. Append the trend row to docs/retros/ledger.md (unless no-ledger)
- [ ] 5. Read docs/retros/INSIGHTS.md, draft ≤3 durable lessons, dedup
- [ ] 6. Append survivors (append-only)
- [ ] 7. One-line summary to the user
```

## Non-destructive write contract (hard rule)

Identical to engineering-insights: `docs/retros/INSIGHTS.md` and `docs/retros/ledger.md` are
append-only; re-read immediately before writing; anchored `Edit` inserts under the right heading
(ledger: append the row at the end of the table); never overwrite, never delete, supersede with
dated notes; idempotent on duplicates. Per-run RETRO files are write-once — if a retro for this
run already exists, update it with `Edit`, don't create a second one. The bundled
`analyze_journals.py` is read-only — it never writes anything.
