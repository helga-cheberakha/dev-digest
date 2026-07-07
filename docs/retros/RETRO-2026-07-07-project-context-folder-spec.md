# Retro — Project Context Folder: spec creation (+ planner coordination)   |   2026-07-07   |   branch: lesson/05

## Run metadata
- Workflow: spec→plan (spec-creator ×3 runs, implementation-planner ×1); /implement not yet run
- Artifacts: `specs/SPEC-2026-07-07-project-context-folder.md` (draft, 26 ACs),
  `docs/plans/PLAN-project-context-folder.md` (14 tasks, 5 phases)
- Outcome: shipped (spec + plan complete, awaiting human review before /implement)

## Agent runs (in launch order)
| # | Agent | Mode | Resumed | Tokens¹ | Tool uses | Duration | Batch |
|---|-------|------|---------|---------|-----------|----------|-------|
| 1 | spec-creator (initial) | sync | — | 103,541 | 16 | 4m46s | A |
| 1a | spec-creator (resume: resolve 4 clarifications) | background | 1× | 141,790 | 4 | 42s | B |
| 2 | implementation-planner | background | 0× (+1 mid-run message) | 129,785 | 20 | 11m17s | C |
| 1b | spec-creator (resume: user refinements → AC-24/25/26) | background | 2× | 194,284 | 13 | 3m37s | C |

¹ `subagent_tokens` as reported per notification; for the same agent the figures grow across
resumes (103,541 → 141,790 → 194,284), consistent with a cumulative transcript total, so the
resumes cost ≈ 38k and ≈ 52k incrementally under that reading.

- **Totals:** 2 agents, 2 resumptions + 1 mid-run SendMessage; Σ ≈ 324,069 tokens under the
  cumulative reading (194,284 spec-creator final + 129,785 planner); Σ agent active time ≈ 20m22s;
  wall-clock n/a (dominated by user think-time between gates).
- **Order & parallelism:** spec-creator ran sync (its output gated everything). The planner was
  backgrounded after the clarification-resolution resume. Batch C overlapped: the user's new
  requirements arrived while the planner was already running, so spec resume 1b (3m37s) executed
  concurrently with the planner and a delta message was queued to the planner mid-run.

## What was hard
- **Spec churn after planning started.** The planner launched against spec rev 2 (23 ACs); the
  user's refinements moved it to rev 3 (26 ACs) mid-plan, forcing a mid-run delta message and
  creating a real plan/spec divergence risk. It worked (the planner folded AC-24/25/26 in), but
  only because the delta was small and purely client-side.
- **Requirements arrived in three waves** (initial request → 4 clarification answers → 3 new
  requirements), each requiring a spec-creator resume. Not avoidable entirely — the user's
  "wait clarification and user stories" interjection showed a deliberate review-gate style — but
  the orchestration didn't anticipate it.

## What was easy / worked well
- **Resume-instead-of-respawn.** Both spec updates went through `SendMessage` to the existing
  spec-creator, keeping its research context: the clarification resume took 4 tool uses / 42s vs
  the cold start's 16 tool uses / 4m46s. Cheapest possible revision path.
- **Text-described mockups.** The four design screenshots were transcribed into the spec-creator
  brief (layout, labels, badge colors, footer text), so a no-vision subagent produced UI ACs that
  match the designs — including flagging mock decoration (coverage ring, chunk indexing) as
  probable non-goals, which the user confirmed.
- **Pre-verified grounding facts in the brief.** The main session verified the reviewer-core
  `specs` slot, vendored-contract lockstep, AgentEditor tab sync points, and clone location BEFORE
  spawning, and passed them as "verified, don't re-derive". Both agents built on them; the spec
  correctly required zero reviewer-core changes and the planner confirmed it.
- **One batched AskUserQuestion** resolved 4 decisions (repo scoping, trace granularity, caps,
  proposals) in a single round-trip.

## Duplicated information
- The same grounding-facts block was pasted into both the spec-creator and planner briefs
  (intentional and cheap, but it is duplicated context).
- The planner had to re-read the full spec after the delta message (unavoidable given the mid-run
  revision — see "What was hard").
- spec-creator re-verified `prompt.ts` slot details the main session had already grepped (minor;
  the brief said "verify surrounding details", so partially by design).

## What was missed
- **Spec-stage escape:** the spec's provenance said discovery uses "the existing git/clone read
  boundary", but `GitClient` exposes only `readFile` — no directory walk. The missing `listDocs`
  port surfaced only at planning (planner gap #1). A spec-brief instruction to enumerate the
  concrete port methods behind each provenance claim would have caught it a stage earlier.
- AC-3's empty-state wording conflated clone-sync state with repo-intel indexing (planner gap #2).
- The Project Context page's repo-id source (client `repo-context`) was unstated in the spec
  (planner gap #3).
- The mock-visible "SERIALIZES AS" block was initially filed as an out-of-scope [PROPOSAL]; the
  user pulled it into scope. Mock-visible elements are a weak default for "out of scope".
- Attach-from-page (AC-24) and the expandable full injected text (AC-25) were genuinely new user
  requirements, not spec misses — but AC-25 turned out to need zero backend work, which the first
  draft could have discovered by checking what `prompt_assembly.specs` already stores.

## User interventions
1. **"wait clarification and user stories"** (mid-turn) — paused the pipeline before planning;
   converted the flow into explicit review gates.
2. **4 clarification answers** — single-repo scan, block-level trace total, 20k/40k caps,
   SERIALIZES AS into scope → spec rev 2.
3. **New requirements message** — attach from the Project Context page, full injected text in the
   prompt-assembly view, page-level token counts → AC-24/25/26 (spec rev 3) + planner delta.
4. **"I'll review first"** — gated /implement on human review of spec + plan.

## Next-time adjustments
- **Don't background the planner while the spec can still move.** Launch it only after the user's
  review gate on the spec — this user gates every stage; the mid-run delta was avoidable
  sequencing risk, not a win.
- **Ask the gating question up front** ("review each artifact, or run the chain through?") —
  intervention #1 revealed a preference one cheap question would have surfaced before spawn #1.
- **Spec-creator brief: require naming the concrete port/method behind every "existing boundary"
  provenance claim** — would have caught `GitClient.listDocs` at spec time.
- **Treat mock-visible elements as in-scope by default** in spec briefs; demote to proposals only
  with an explicit cost argument.
