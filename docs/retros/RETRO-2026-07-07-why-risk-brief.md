# Retro — Why+Risk Brief (SDD pipeline)   |   2026-07-07   |   branch: lesson/05   |   data: deep

## Run metadata
- Workflow: full SDD — spec-creator → implementation-planner (+ GPT-5 cross-model review, run
  manually by the user via a prepared packet) → /implement (18 tasks, 6 batches, multi-agent) →
  review gate (architecture-reviewer ∥ plan-verifier) → 1 arch-fix iteration → pr-self-review
  (2 analyzer buckets) → 1 warning-fix iteration.
- Artifacts: `specs/SPEC-2026-07-07-why-risk-brief.md`, `docs/plans/PLAN-why-risk-brief.md`,
  `docs/plans/REVIEW-why-risk-brief-cross-model.md`; commits `7808b2d` (spec) → `c4d120f` (plan)
  → `ad8691a` (plan 2b) → `c1601b1`/`ae2e226`/`f784ba3`/`3d7e1dc`/`98d886b`/`3e78fff` (T1–T18)
  → `3a7978a` (review fixes 1) → `3281b78` (review fixes 2).
- Outcome: shipped locally (not pushed, by design) — 18/18 tasks COMPLETE, 0 violations, all
  AC-1..AC-17 + NF-UNTRUSTED covered, pr-self-review PASS (0 CRIT/HIGH/MED left; 1 LOW).

## Agent runs (in launch order; └ = nested sub-agent)
| # | Agent | Task | Mode | Resumed | Tokens (in/out) | Cache hit | Tools | Span | Batch |
|---|-------|------|------|---------|-----------------|-----------|-------|------|-------|
| 1 | spec-creator | spec | sync | 1× | 25,168 / 37,864 | 90% | 34 | 15m31s | — |
| 2 | implementation-planner | plan + revision | sync | 3× | 41,265 / 60,813 | 89% | 47 | 62m02s | — |
| 3 | implementer-backend | T1 contracts | sync ∥ | — | 91 / 8,355 | 93% | 28 | 2m27s | B1 |
| 4 | implementer-backend | T2 migrations | sync ∥ | — | 59 / 2,441 | 92% | 17 | 1m42s | B1 |
| 5 | implementer-backend | T3 repository | sync ∥ | — | 77 / 5,886 | 94% | 22 | 4m05s | B2 |
| 6 | implementer-backend | T4 assembler | sync ∥ | — | 64 / 14,832 | 90% | 20 | 4m33s | B2 |
| 7 | implementer-backend | T7 risk_areas rm | sync ∥ | — | 115 / 8,960 | 96% | 32 | 4m06s | B2 |
| 8 | implementer-backend | T8 tokens/cost | sync ∥ | — | 79 / 8,811 | 92% | 22 | 3m47s | B2 |
| 9 | implementer-ui | T9 hook | sync ∥ | — | 56 / 5,139 | 90% | 17 | 2m38s | B2 |
| 10 | implementer-ui | T11 accordion | sync ∥ | — | 151 / 21,308 | 95% | 42 | 6m55s | B2 |
| 11 | implementer-backend | T5 service | sync ∥ | — | 14,393 / 27,083 | 95% | 57 | 7m15s | B3 |
| 12 | implementer-ui | T10 card | sync ∥ | — | 217 / 33,099 | 97% | 59 | 9m00s | B3 |
| 13 | implementer-backend | T13 unit tests | sync ∥ | — | 87 / 21,492 | 94% | 25 | 4m43s | B3 |
| 14 | implementer-backend | T15 contract tests | sync ∥ | — | 151 / 16,247 | 96% | 45 | 4m39s | B3 |
| 15 | implementer-backend | T6 routes | sync ∥ | — | 109 / 8,477 | 95% | 32 | 3m11s | B4 |
| 16 | implementer-ui | T12 deep-link | sync ∥ | — | 177 / 35,741 | 97% | 50 | 10m52s | B4 |
| 17 | implementer-ui | T16 component tests | sync ∥ | — | 149 / 28,658 | 96% | 44 | 8m19s | B4 |
| 18 | implementer-backend | T14 it-tests | sync ∥ | — | 239 / 65,432 | 97% | 69 | 14m41s | B5 |
| 19 | implementer-ui | T17 e2e + seed | sync ∥ | — | 141 / 17,548 | 96% | 45 | 4m50s | B5 |
| 20 | implementer-backend | T18 final gate | sync | — | 77 / 5,537 | 93% | 21 | 2m37s | B6 |
| 21 | architecture-reviewer | review gate | sync ∥ | 2× | 159 / 26,666 | 90% | 53 | 12m51s | G |
| 22 | plan-verifier | review gate | sync ∥ | — | 4,317 / 12,145 | 94% | 36 | 2m54s | G |
| 23 | implementer-backend | fix HIGH-1/2 | sync | — | 61 / 9,139 | 90% | 17 | 3m18s | F1 |
| 24 | general-purpose | self-review backend | sync ∥ | — | 114 / 15,926 | 95% | 29 | 5m08s | SR |
| 25 | general-purpose | self-review UI | sync ∥ | — | 100 / 14,189 | 95% | 25 | 5m12s | SR |
| 26 | implementer-backend | fix assembler MEDs | sync ∥ | — | 85 / 22,589 | 93% | 23 | 4m25s | F2 |
| 27 | implementer-ui | fix retry HIGH | sync ∥ | — | 55 / 6,026 | 90% | 16 | 1m35s | F2 |

- **Totals:** 27 agents (0 nested, max depth 1), 6 resumptions (spec-creator 1, planner 3, arch-reviewer 2),
  Σ 87,756 in / 540,403 out, cache-read 160.5M (**cache hit 93.6%**), 927 tool calls,
  Σ agent spans 3h33m, wall-clock 3h10m, parallelism 1.12×, cost n/a (no prices file passed).
- **Critical path:** implementation-planner (62m — includes TWO mid-write API connection failures,
  the incremental-write restart, and the post-cross-model revision resume). Runner-up: T14 (14m41s).
- **Order & parallelism:** batches B1(2)∥, B2(6)∥, B3(4)∥, B4(3)∥, B5(2)∥, F2(2)∥, gate(2)∥,
  self-review(2)∥ all ran concurrently inside the batch; the low 1.12× overall factor is dominated
  by the serialized spec→plan→cross-model head (user gates + manual GPT-5 run + planner retries),
  not by the implement phase.

## What was hard
- **Three "connection closed mid-response" API failures** — twice on the planner's single giant
  plan Write, once on the architecture-reviewer's re-review resume. Mitigation that worked:
  instruct the agent to write large artifacts incrementally (header first, then per-section
  appends); the planner (no Edit tool) fell back to `cat >>` heredocs and later `python3`
  str.replace scripts for the revision.
- **Shared branch with a parallel session** (onboarding plan committing interleaved on lesson/05,
  untracked leftovers in the tree): every batch commit had to list explicit paths; every
  implementer brief needed an "ignore unrelated in-progress files" clause. It worked (zero
  cross-contamination), but it is per-brief overhead and a standing risk.
- **No LLM keys in the environment** for the promised OpenRouter cross-model review — discovered
  only at execution time (all three key vars empty; the app runs on a local model). Fallback: a
  self-contained packet file (staff-engineer prompt + spec + plan) the user pasted into GPT-5
  manually, verdict pasted back.
- The planner lacks the Edit tool by definition, which turned the post-review revision into
  bash/python string surgery instead of anchored edits.

## What was easy / worked well
- **The two-tier tsc gate** (GPT-5's B1 fix): per-task gates scoped to owned files + one final
  full-package T18 sink. T1's intentionally breaking contract changes rippled through 5 sibling
  tasks in the same run with zero gate deadlocks and zero waived checks.
- **Owned-paths discipline held across 27 agents on one branch** — several implementers reported
  seeing other tasks' WIP in `git status` and correctly left it alone.
- **Dispatch briefs carrying predecessor exports** (T4's function signatures into T5/T13; T9's
  hook signatures into T10; T10/T11 props into T12/T16) — downstream implementers never re-derived
  interfaces, and no batch-boundary integration bug appeared.
- **GPT-5 cross-model review earned its keep**: 3 genuine blockers (unsatisfiable gates, unpinned
  isolation level for the advisory-lock double-check, a stale spec-vs-plan API signature) that
  none of the same-family agents had flagged.
- The real-Postgres AC-17 test ran locally for free — `dotenv/config` auto-loads `server/.env`'s
  `DATABASE_URL`, so the `skipIf` suite executed instead of skipping.

## Duplicated information
- Every implementer re-reads the plan file + its module's AGENTS/INSIGHTS per its contract
  (~18 reads of the same ~27K-token plan). The 93.6% cache-hit ratio absorbed most of the cost,
  but a per-task excerpt in the brief would shrink cold-cache exposure further.
- `parseFileRef` got implemented twice (PrBriefCard, IntentCard) as a deliberate consequence of
  non-overlapping owned paths — flagged LOW by the reviewer; a shared util would need a T1-style
  "shared lib" task next time.

## What was missed
- **Plan gap:** `reviewer-core/src/prompt.ts` consumed `Intent.risk_areas` and was in nobody's
  owned paths (the plan declared "reviewer-core — no change"). Caught by tsc right after Batch 1;
  fixed by extending T7's dispatch with an orchestrator-authorized addition.
- **Spec drift:** the spec's "binding entry point" `buildBlast(db, prId)` was stale; the plan's
  4-arg signature was right. Only the cross-model reviewer forced the explicit resolution (B3).
- **Filename convention:** the plan named the e2e spec without the `.flow.json` suffix — the
  runner's glob would have silently never executed it. Caught by the T17 implementer reading
  `run.ts` first.
- `server/test/contracts.test.ts` (fixtures of deleted contracts) had no owning task — it fell
  through to T18's reconciling-fixup authorization, which worked but was luck, not design.

## User interventions
- Approved the spec with 2 decisions: rework the existing PrBriefCard in place; AC-11 strictly
  per spec (scope expansion into the reviews module for tokens_in/out).
- Chose to stay on lesson/05 despite the unmerged onboarding work (PR will contain both).
- Resolved the plan's one `[NEEDS DECISION]`: add `ProjectContextService.readAttachedDocs`.
- Ran the GPT-5 cross-model review manually (no API keys available) and pasted the verdict back.
- One accidental terminal-scrollback paste ("wrong input") — cost one clarification round; it
  also leaked a live Stripe webhook secret into the chat (flagged to the user).
- Accepted all 6 plan-verifier DRIFT items; ordered the HIGH+2×MEDIUM warning fixes.

## Next-time adjustments
- **Give `implementation-planner` the Edit tool** (`.claude/agents/implementation-planner.md`,
  tools list): it writes 700+ line plans and revises them; without Edit it needed `cat >>` and
  python heredocs, and its giant single Writes were where both connection failures landed.
  Expected effect: no incremental-write workarounds, fewer retry round-trips.
- **Brief any artifact-writing agent to emit large files incrementally by default** (section-wise
  appends) — both connection failures this run were mid-giant-Write; the incremental restart
  succeeded first try.
- **Add a "consumer sweep" step to plan authoring**: before finalizing owned paths for a task that
  deletes/narrows a shared symbol, grep ALL packages that compile it (including path-alias
  consumers like reviewer-core) and assign every hit to a task. Would have put
  `reviewer-core/src/prompt.ts` and `test/contracts.test.ts` in owned paths up front.
- **Check external prerequisites (API keys) at pipeline start**, not at the step that needs them —
  the cross-model stage stalled on an empty `OPENROUTER_API_KEY` that a 5-second check at kickoff
  would have surfaced while the planner was still running.
- **When naming new files in a plan, verify the discovering glob/convention first** (e2e
  `*.flow.json` here) — one grep in the runner beats a silently-never-run test.
