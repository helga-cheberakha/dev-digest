# Retro — Onboarding Generator (full SDD pipeline)   |   2026-07-07   |   branch: lesson/05   |   data: deep

## Run metadata
- Workflow: spec→plan→cross-model review→/implement (spec-creator → implementation-planner → GPT-5-in-Cursor staff review → 16-task multi-agent implement → architecture-reviewer + plan-verifier gate → 1 fix iteration → engineering-insights)
- Artifacts: `specs/SPEC-2026-07-07-onboarding-generator.md`, `docs/plans/PLAN-onboarding-generator.md`, commits `eb7dcbb` (spec), `51b39ea`+`bfa6568`/`ad8691a` (plan + revision), `18e4b41`→`469e93f` (7 implement/fix commits), `609726a` (insights)
- Outcome: shipped — 16/16 tasks COMPLETE, gate PASS (0 CRITICAL/HIGH, 0 VIOLATIONS, 23/23 ACs), 122 AC-derived tests green; final demo (tour on an unfamiliar repo + costUsd) deliberately deferred

## Agent runs (in launch order; no nested sub-agents this run)
| # | Agent | Mode | Resumed | Tokens (in/out) | Cache hit | Tool uses | Span | Batch |
|---|-------|------|---------|-----------------|-----------|-----------|------|-------|
| 1 | spec-creator (opus-4-8) | sync | 1× | 20,002 / 20,889 | 69.4% | 15 | 9m39s | stage 1 |
| 2 | implementation-planner (opus-4-8) | bg | 1× | 23,695 / 60,095 | 83.1% | 26 | 24m04s | stage 2 |
| 3 | implementer-backend T1 contract | bg | — | 47 / 8,957 | 89.9% | 21 | 3m44s | B1 |
| 4 | implementer-backend T2 migration | bg | — | 26 / 2,489 | 82.2% | 10 | 1m22s | B1 |
| 5 | implementer-backend T3 howToRun | bg | — | 29 / 12,208 | 86.9% | 12 | 3m34s | B2 |
| 6 | implementer-backend T4 hotness+readingPath | bg | — | 43 / 10,234 | 89.4% | 21 | 5m03s | B2 |
| 7 | implementer-backend T5 criticalPaths+arch | bg | — | 55 / 14,154 | 92.3% | 29 | 6m31s | B2 |
| 8 | implementer-backend T6b gaps | bg | — | 47 / 17,579 | 91.4% | 22 | 5m38s | B2 |
| 9 | implementer-backend T7 grounding | bg | — | 34 / 6,608 | 87.1% | 15 | 2m31s | B2 |
| 10 | implementer-backend T8 prompt+skeleton | bg | — | 61 / 14,061 | 93.2% | 33 | 6m33s | B2 |
| 11 | implementer-backend T9 repository | bg | — | 41 / 6,606 | 89.6% | 16 | 2m57s | B2 |
| 12 | implementer-ui T12 hooks+api | bg | — | 38 / 8,772 | 88.2% | 17 | 3m00s | B2 |
| 13 | implementer-backend T6 firstTasks | bg | — | 29 / 5,599 | 83.8% | 12 | 2m34s | B3 |
| 14 | implementer-ui T13 tour page+nav | bg | — | 123 / 64,199 | 96.1% | 77 | 23m07s | B3 |
| 15 | implementer-backend T10 service | bg | — | 23,157 / 93,501 | 97.0% | 123 | 37m13s | B4 |
| 16 | implementer-backend T14 analyzer tests | bg | — | 57 / 22,020 | 92.4% | 35 | 7m50s | B4 |
| 17 | implementer-ui T16 component tests | bg | — | 27,302 / 33,964 | 93.9% | 36 | 10m18s | B4 |
| 18 | implementer-backend T11 routes | bg | — | 54 / 9,134 | 91.8% | 24 | 3m34s | B5 |
| 19 | implementer-backend T15 integration tests | bg | — | 133 / 91,548 | 91.7% | 68 | 35m17s | B6 |
| 20 | architecture-reviewer (sonnet-5) | bg | — | 7,707 / 18,255 | 92.3% | 48 | 4m10s | gate |
| 21 | plan-verifier (sonnet-5) | bg | — | 3,173 / 13,815 | 92.3% | 29 | 2m54s | gate |
| 22 | implementer-backend fix-1 firstTasks skeleton | bg | — | 49 / 8,968 | 92.0% | 21 | 4m21s | fix |

- **Totals:** 22 agents (0 nested, max depth 1), 2 resumptions, Σ 105,902 in / 543,655 out (+96.9M cache-read / 8.2M cache-write), cache hit **92.1%**, Σ agent spans 3h25m53s, wall-clock 2h47m31s, parallelism **1.23×**, cost n/a (no price table passed)
- **Critical path:** T10 service orchestrator (37m13s) → T11 (3m34s) → T15 (35m17s) — a ~76-minute serialized chain; second-longest independent span was the Opus planning stage (24m).
- **Order & parallelism:** B2 ran 8 agents truly concurrently (starts within 47s of each other) and B4 ran 3 — yet overall parallelism is only 1.23× because the T10→T11→T15 chain and the two Opus stages serialized most of the wall-clock. Implementers ran on sonnet-4-6, gate reviewers on sonnet-5, spec/plan on opus-4-8.
- Note: subagent totals only; main-session (orchestrator) tokens not included (n/a in journal set).

## What was hard
- **T10 burned a large share of its 123 tool calls on a self-inflicted parse bug**: a `*/` inside a JSDoc backtick terminated the block comment and corrupted all downstream parsing; tsc errors pointed far from the cause (now in `server/INSIGHTS.md`).
- **`AskUserQuestion` is unavailable inside subagents** — spec-creator couldn't run the required 6-category user dialogue; the orchestrator re-ran it in the main session and resumed the agent with answers (extra round-trip, but the resume cost only ~25s/1 tool call).
- **Plan mislocated a cross-cutting edit**: `activeKeyFor` was planned in `vendor/ui/nav.ts` but lives in `app-shell/helpers.ts`; T13 correctly refused to leave its owned paths, orchestrator applied the 1-line fix inline, and plan-verifier still (rightly) flagged DRIFT requiring a human decision — three touches for one line.
- **Blocking `TaskOutput` (600s) on a running agent dumped raw JSONL transcript into orchestrator context** — the completion notification would have sufficed.

## What was easy / worked well
- **Threading landed API signatures into dependent briefs**: T10's brief embedded all 11 analyzer/repository signatures from batch reports — no sibling re-research; most implementers' raw (uncached) input was 26–133 tokens.
- **Disjoint owned paths held under 8-way concurrency** — zero conflicts, zero file races across the whole run; the one boundary refusal (T13/helpers.ts) was the mechanism working as designed.
- **AC-oracle test tasks** (T14/T15/T16, tests derived from spec observables with "report defects, don't weaken") validated the implementation independently — 122 tests, zero weakening, and the instruction proved cheap insurance.
- **Cross-model plan review (GPT-5, repo access via Cursor) before implementation**: verified all 10 codebase claims, found 2 blockers (AC-13 had no fact source; `.min()` caps vs degraded skeletons) that would otherwise have surfaced mid-implement or at the gate.
- **Cache behavior**: 92.1% aggregate hit; the two heaviest agents (T10 97.0%, T13 96.1%) were the *most* cache-efficient — long agents amortize their prefix well.

## Duplicated information
- Every implementer re-read the ~670-line plan file plus the module INSIGHTS.md (by contract). ~16 reads of the same plan; acceptable per-task isolation cost, but a per-task excerpt in the brief could trim the cold-start for small tasks (T2, T7 finished in <3m — plan reading was a visible fraction).
- The "depcruise doesn't exist" fact was independently re-confirmed by ~6 backend agents (each read the INSIGHTS entry, then still verified by inspection). Fixing the missing script would retire this recurring cost.

## What was missed
- The plan's skeleton contract said "firstTasks always omitted" — nobody noticed until architecture-reviewer that gap detection runs pre-LLM, so LLM-failure skeletons were discarding real work (MEDIUM, fixed in iteration 1).
- The plan named the wrong file for the nav active-key edit (planner assumed the resolver lived beside the nav registry instead of grepping the symbol).
- `git add -A` on a shared worktree swept an unrelated file (a parallel session's `REVIEW-why-risk-brief-cross-model.md`) into a batch commit — caught and amended; explicit paths used thereafter. A parallel session interleaved why-risk-brief commits on the same branch throughout this run.

## User interventions
- Six clarification categories answered (all recommended defaults accepted) — resolved via main-session AskUserQuestion after the subagent limitation surfaced.
- Stage gates: spec approved, plan approved, "Cursor with GPT-5" chosen for the cross-model review, review verdict pasted back, DRIFT accepted, MEDIUM fix approved ("fix now"), "wrap up".
- No mid-implementation corrections — the batches ran without course changes.

## Next-time adjustments
- **Split orchestrator-shaped tasks**: T10 (13 steps, 907 lines, 37m) owned the critical path; splitting fact-collection from generation orchestration would let its test task start earlier and roughly halve the serialized chain (~30 min wall-clock saved).
- **Design the clarification flow around the subagent limitation**: brief spec-creator to *return* its question set instead of asking it to run a dialogue; main session asks, then resumes. Saves a wasted instruction and one confusion round-trip.
- **Planner must grep exact file locations for cross-cutting edits** (symbols like `activeKeyFor`) instead of inferring from module layout — one wrong Owned-path line cost an implement-time refusal + an orchestrator amendment + a DRIFT decision.
- **Add the missing `depcruise` script/config** (recurring in `server/INSIGHTS.md`): 6+ agents per run hand-verify onion boundaries that a 5-second command should gate.
- **Never block on `TaskOutput` for a running implementer** — await task-notifications; blocking dumped a raw JSONL transcript into context.
- **Use explicit paths in batch commits** when any parallel session may share the worktree; `git add -A` is not safe on a shared branch.
