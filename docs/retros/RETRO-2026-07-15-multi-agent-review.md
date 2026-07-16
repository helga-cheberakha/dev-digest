# Retro — Multi-Agent Review   |   2026-07-15   |   branch: lesson/07-multi-agents-review   |   data: deep

## Run metadata
- Workflow: spec-creator → implementation-planner → /implement (5-task parallel DAG) → gate →
  fix-loop → re-gate → pr-self-review → direct fix
- Artifacts: `specs/SPEC-2026-07-15-multi-agent-review.md`, `docs/plans/PLAN-multi-agent-review.md`,
  commits `25fe3fa`…`a53ccbb` (6 commits) on `lesson/07-multi-agents-review`
- Outcome: shipped — feature implemented, gated twice (clean both times after the fix round), and
  pr-self-review's 5 HIGH findings patched directly in the same session

## Agent runs (in launch order; └ = nested sub-agent)
| # | Agent | Mode | Resumed | Tokens (in/out, non-cache) | Cache hit | Tool uses | Duration | Batch |
|---|-------|------|---------|------------------------------|-----------|-----------|----------|-------|
| 1 | spec-creator | sync | — | 70 / 17,811 | 83.2% | 19 | 11m09s | S |
| 2 | implementation-planner | sync | — | 118 / 26,308 | 93.8% | 27 | 8m51s | P |
| 3 | implementer-backend (T1: contracts+migration+schema) | sync | — | 7,390 / 7,416 | 89.6% | 24 | 2m52s | B1 (solo) |
| 4 | implementer-backend (T2: server module) | bg | — | 93 / 32,028 | 95.6% | 52 | 10m31s | B2 |
| 5 | implementer-ui (T3: hooks + PR picker) | bg | — | 79 / 15,733 | 95.8% | 43 | 11m09s | B2 |
| 6 | implementer-ui (T4: Configure-run page) | bg | — | 121 / 28,043 | 96.8% | 74 | 9m00s | B2 |
| 7 | implementer-ui (T5: Results page) | bg | — | 126 / 42,767 | 96.7% | 78 | 14m37s | B2 |
| 8 | architecture-reviewer (gate 1) | bg | — | 205 / 44,925 | 96.2% | 63 | 9m52s | G1 |
| 9 | plan-verifier (gate 1) | bg | — | 147 / 23,367 | 94.7% | 45 | 5m50s | G1 |
| 10 | implementer-backend (fix: R7 golden fixtures) | bg | — | 78 / 24,786 | 94.4% | 41 | 7m46s | F1 |
| 11 | implementer-ui (fix: Configure fixture + i18n key) | bg | — | 88 / 11,385 | 96.5% | 48 | 5m19s | F1 |
| 12 | implementer-ui (fix: Results page, 6 issues) | bg | — | 108 / 24,514 | 96.7% | 55 | 8m23s | F1 |
| 13 | architecture-reviewer (gate 2 / re-review) | bg | — | 157 / 23,840 | 95.1% | 49 | 5m41s | G2 |
| 14 | plan-verifier (gate 2 / re-verify) | bg | — | 136 / 11,347 | 95.2% | 41 | 2m44s | G2 |
| 15 | general-purpose (pr-self-review UI bucket) | bg | — | 52 / 23,165 | 63.4% | 18 | 5m39s | R1 |
| 16 | general-purpose (pr-self-review backend bucket) | bg | — | 80 / 13,691 | 83.2% | 28 | 4m16s | R1 |
| 17 | └ Explore (find shared contract types) | nested, depth 2 | — | 34 / 2,051 | 80.3% | 11 | 1m09s | under #16 |

- **Totals:** 17 agents (1 nested, max depth 2), 0 resumptions, 9,082 / 373,177 tokens (non-cache
  in/out) + 100.8M cache-read / 6.26M cache-write, **cache hit 94.1%**, Σ tool calls 716,
  Σ agent-span 2h04m46s, **wall-clock 2h59m35s**, **parallelism 0.69x**, **cost ≈ $55.33**
  (subagent spawns only — main-session/orchestrator tokens aren't observable and are excluded).
  Priced at rates in effect 2026-07-15: Opus 4.8 $5/$25 per MTok, Sonnet 4.6 $3/$15, Sonnet 5
  $2/$10 (introductory, through 2026-08-31) per MTok in/out; cache write assumed at the 5-minute
  TTL default (1.25× input price), cache read at 0.1× input price. Breakdown by model: Opus 4.8
  (spec-creator + implementation-planner) $11.70, Sonnet 4.6 (5 implementer runs) $26.27,
  Sonnet 5 (2 gate pairs + pr-self-review + nested Explore) $17.37.
- **Critical path:** spec-creator (11m09s) → implementation-planner (8m51s) → T1 solo (2m52s) →
  T5/Results-page (14m37s, longest of the B2 batch) → architecture-reviewer gate 1 (9m52s) →
  Results-page fix (8m23s, longest of F1) → architecture-reviewer gate 2 (5m41s) →
  pr-self-review UI bucket (5m39s) ≈ **67 minutes of agent-active time**
- **Order & parallelism:** one true fan-out (B2: T2–T5, 4-wide) and three 2-wide gate/fix
  batches (G1, F1, G2, R1). Parallelism (0.69x) is *below* 1 even though every batch after T1 ran
  concurrently — because the 0.69x formula divides by **wall-clock**, and roughly half the
  ~3-hour wall-clock was user think-time / manual verification between batches (spec revision
  08:43–09:10 UTC before the planner spawned; a ~40 min gap 10:42→11:22 UTC where the user ran the
  plan's R8 manual `/verify` integration checkpoint directly, not via an agent). The agent batches
  themselves parallelized correctly; the metric is picking up idle orchestrator time, not batch
  inefficiency.

## What was hard
- R7 (golden-fixture drift guard) and R8 (manual integration checkpoint) were not in the original
  5-task plan — they were raised by **architecture-reviewer at gate 1**, *after* T1–T5 were already
  implemented (gate 1 ran 10:08–10:18 UTC, well after T2–T5 finished at ~10:06 UTC). That forced a
  dedicated fix round (F1) plus a second full gate (G2) instead of being caught at planning time.
- A mid-session correction ("memory" = `engineering-insights`/`memory.jsonl`, not the sidebar
  Memory tab) landed at 09:43 UTC, *after* both the spec and the plan had already been written —
  the user had to ask explicitly to "verify this in the spec, plan, AND implementation," i.e. a
  cross-artifact consistency check bolted on after two artifacts were already frozen.

## What was easy / worked well
- The T1→(T2‖T3‖T4‖T5) DAG shape: one foundational backend task (contracts/migration/schema, 2m52s
  solo), then a clean 4-wide fan-out with non-overlapping owned paths (server module / hooks+PR
  picker / Configure page / Results page). All four landed with zero cross-task conflicts.
- Both gates (architecture-reviewer + plan-verifier) ran as a genuine parallel pair both times
  (G1 and G2), and gate 2 came back clean after the F1 fix round — the bounded fix-loop worked
  exactly as designed on the first iteration.
- For the *final* fix round — pr-self-review's 5 HIGH findings — the main session applied every
  fix directly via `Edit` (11:32–11:38 UTC) instead of spawning another implementer. No agent
  cold-start, no INSIGHTS.md re-read; the orchestrator already had full context from the
  pr-self-review report.

## Duplicated information
- The pr-self-review backend bucket (#16) had to spawn a nested `Explore` agent (#17, 68.7s, 11
  tool calls) just to relocate the shared contract-type definitions in
  `server/src/vendor/shared/contracts/` — a location T1's implementer had already established
  ~2 hours earlier in the same run. The bucket brief didn't carry that path forward.

## What was missed
- R7/R8 (see "What was hard") — a scope gap the plan review should ideally have surfaced before
  dispatching T2–T5, not after.
- The 5 HIGH findings from `pr-self-review` (final commit `a53ccbb`) were only caught at the very
  last gate, after both architecture-review gates had already passed clean.

## User interventions
- 08:43 UTC — pointed spec-creator at a specific design file (`DevDigest Design (standalone) (7).html`)
  to use as the UI reference, mid spec-authoring.
- 08:59 UTC — "keep as separate groups" (spec UI correction, applied via direct `Edit`, not a
  spec-creator resume).
- 09:01 UTC — explicit scope-limiting instruction: keep the implementation very simple, iterate
  after real user feedback.
- 09:10 UTC — explicit instruction to invoke `implementation-planner` (planning gate was
  user-triggered, not automatic).
- 09:43 UTC — correction on what "memory" means in this codebase, with an explicit ask to
  cross-check spec + plan + implementation for it.
- 10:21 UTC — approved R7/R8 as additive scope after they surfaced at gate 1.
- 11:17 UTC — "patch and run pr-self-review."
- 11:32 UTC — "patch the 5 HIGH items now" (executed via direct main-session edits, see above).

## Next-time adjustments
- For small, well-localized fix batches (a handful of files, orchestrator already holds full
  context from a review report — e.g. pr-self-review's 5 HIGH findings here), apply fixes directly
  via `Edit` in the main session rather than spawning another `implementer`. This run saved a full
  agent cold-start + INSIGHTS.md re-read on the final round; keep doing it below roughly
  10 touched files, and reserve fresh implementer spawns for structural/multi-file work.
- Brief any `general-purpose` / `pr-self-review` bucket agent with the concrete path to shared
  contract types (`server/src/vendor/shared/contracts/`, `client/src/vendor/shared/contracts/`)
  up front — bucket #16 paid a 68.7s nested-Explore detour to rediscover what T1's implementer
  had already placed.
- When architecture-reviewer's gate raises a cross-cutting risk that touches already-implemented
  tasks (R7/R8 here), consider a lighter pre-implementation risk pass on the plan itself (the
  `implementation-planner` or a quick architecture skim) before dispatching the parallel batch —
  it would have avoided one full fix-round + re-gate cycle.
- When reading `analyze_journals.py`'s parallelism factor, don't read a sub-1.0x number as
  "batches didn't overlap" without checking the gaps between batch timestamps first — in this run
  every batch after T1 was genuinely concurrent; the 0.69x came from ~90 min of human review/manual
  `/verify` time between batches, which the wall-clock denominator can't distinguish from
  serialization.
