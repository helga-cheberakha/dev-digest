# Implementation Plan: Pipeline token & orchestration optimization

> Source: `docs/retros/RETRO-2026-07-07-onboarding-generator.md` + ledger row `why-risk-brief-sdd`
> (two independent runs, same findings: cold-start overhead on small tasks, plan redundancy,
> monolithic tasks owning the critical path, missing live-verify stage).
> Target: the pipeline's own definition files (`.claude/agents/`, `.claude/skills/`) + server tooling.
> No product code is touched by this plan.

## Overview
Seven fixes across three phases. Phases A and B are file edits executable in one session;
Phase C is measurement on the next feature run. Expected effect on a run of onboarding-generator's
size: **~25–30% less cache-write** (fewer cold starts + smaller per-agent prefix), **~30% less
Opus output** at the planning stage, **6+ fewer manual onion-verifications** per run, and a class
of mock-invisible defects (unapplied migrations, dead routes) caught before insights/retro.

## Execution mode
**single-agent (sequential)** — every task edits shared orchestration files; owned paths overlap
is inherent (A1/A2 both touch planner guidance), and total volume is small. No parallel dispatch.

---

## Phase A — .claude definition files

### A1 — Task granularity + plan slimming rules (implementation-planner)
**File:** `.claude/agents/implementation-planner.md`
**Fixes retro items:** #1 (merge small tasks), #2 (spec duplication), planner grep rule, T10-style monoliths.

1. **Granularity rules** (add to the planning-method section, near the Owned-paths rule at ~L82):
   - *Merge rule:* sibling pure helpers in the same directory, same `Type`, same skill set and no
     mutual dependency → ONE task (e.g. onboarding's T3–T8 six analyzers → 2 tasks: "fact
     analyzers" + "prompt/skeleton/grounding"). A task whose estimated span is < 5 min does not
     justify a ~200k-token cold start.
   - *Split rule:* an `Action` with **10+ numbered steps** is a mandatory split signal (T10's
     13-step, 37-min orchestrator owned the critical path; why-risk-brief's planner analog: 62 min).
     Split so dependents (tests, routes) can start against the earlier half.
2. **No AC restatement** (template section, ~L237): the `## Requirements (verified)` section must
   NOT restate the spec's ACs verbatim — replace with: spec path + list of AC IDs + **deltas only**
   (anything the planner disputes/narrows). The traceability matrix keeps AC **IDs**, not AC prose.
   Rationale in-file: the plan is read ~16× per run by implementers; every duplicated line is paid
   in every agent's prefix, and drift between restated and real ACs is a defect vector.
3. **Grep-before-Owned-paths rule** (red-flags checklist, ~L263): for every cross-cutting edit the
   plan must cite the grep-verified file:line of the symbol being changed ("`activeKeyFor` —
   verified at `client/src/components/app-shell/helpers.ts:29`"), never an assumed location.
   Add checklist line: `- [ ] Every cross-cutting Owned path was grep-verified, not inferred`.
4. **(Adjacent fix from the why-risk-brief ledger row):** add `Edit` to the agent's tools and
   instruct incremental section-by-section plan writes — its giant single `Write` calls were the
   failure point of that run's 62-min critical path.

**Acceptance:** the four rules appear in the file; next planner run produces a plan with a
Requirements section ≤ 15 lines and no task Action > 9 steps.

### A2 — Dispatch briefs with task excerpts + orchestration guardrails (/implement)
**File:** `.claude/skills/implement/SKILL.md`
**Fixes retro items:** #3 (briefs with excerpt), #1 (bundling), #5 (TaskOutput, explicit paths).

1. **Step 1 dispatch change:** the orchestrator (who has already read the plan in Step 0) pastes
   the task's **full block** (Action/Owned paths/gotchas/Acceptance) into each implementer brief,
   plus the shared conventions paragraph, plus batch-mates' owned paths. The plan path is still
   given as fallback reference — but the brief states "your task block is inline; do not re-read
   the plan unless the block references another section".
2. **Bundling rule:** when the ready set contains 3+ tasks of the same `Type` in the same module
   directory with spans estimated small, dispatch them to ONE implementer as an ordered bundle
   (owned paths = union). Cap: one bundle ≤ 4 tasks.
3. **Guardrails additions:** (a) "Never call `TaskOutput` with `block:true` on a running agent —
   completion notifications arrive automatically; on timeout it dumps raw JSONL into your
   context"; (b) "Batch commits use explicit file paths, never `git add -A` — parallel sessions
   may share the worktree" (evidence: the swept `REVIEW-why-risk-brief-cross-model.md`).

**Acceptance:** rules present; a dry-read of Step 1 yields an unambiguous brief format.

### A3 — Implementer contract: inline task block first
**Files:** `.claude/agents/implementer.md`, `.claude/agents/implementer-backend.md`, `.claude/agents/implementer-ui.md`
**Fixes retro item:** #3.

Change the "read your task from the plan" contract to: *if the dispatch brief embeds the task
block, treat it as authoritative and skip the plan read; still read the module's INSIGHTS.md
(unchanged); read the plan only if the block references another section.* Same edit in all three
profiles (they share the contract wording).

**Acceptance:** all three files carry the identical amended contract paragraph.

### A4 — spec-creator: clarification protocol + fallback-AC rule
**File:** `.claude/agents/spec-creator.md`
**Fixes:** subagent-dialogue limitation; the AC-9 "what is preserved" hole.

1. Replace the "ask up front with AskUserQuestion" instruction (~L208) with a dual-path protocol:
   *AskUserQuestion does not function when running as a subagent. Default flow: write the spec with
   defensible defaults, return a structured "Questions for the user" block (question, options,
   recommended default, what changes if flipped) — the MAIN session runs the dialogue and resumes
   you with answers via SendMessage.* Keep AskUserQuestion in tools for direct (non-subagent) runs.
2. Add to the EARS guidance: *for every fallback/degrade AC, the criterion must state what is
   **preserved** across the fallback, not only what is returned* — with the onboarding AC-9
   example: "return the skeleton" silently permitted discarding pre-computed First Tasks; the
   correct form is "return the skeleton **retaining every section computed before the failure**".

**Acceptance:** both edits present; the questions-block format is concrete enough to parse.

---

## Phase B — server tooling

### B1 — Wire the depcruise gate
**Files:** `server/.dependency-cruiser.cjs` (new), `server/package.json` (one script line),
`server/INSIGHTS.md` (append-only supersede note).
**Fixes retro item:** #4.

1. Apply the ready-made config + npm script from
   `.claude/skills/onion-architecture/enforcement.md` (dependency-cruiser `^17.4.3` is already a
   devDependency — config and script are the only missing pieces).
2. Run `npm run depcruise`; fix nothing in product code in this plan — if pre-existing violations
   surface, record them as `known` exceptions in the config with a TODO comment (the gate must
   land green so implementers can rely on it; burning down exceptions is a follow-up).
3. Append to `server/INSIGHTS.md` (Tool & Library Notes) a dated note superseding the 2026-07-07
   "npm run depcruise does NOT exist" entry.
4. No skill edits needed: `pr-self-review` and the plans' testing strategies already reference the
   gate conditionally ("when configured") — adding the config activates them.

**Acceptance:** `cd server && npm run depcruise` exits 0; INSIGHTS supersede note appended.

---

## Phase C — pipeline stage + measurement

### C1 — Live-verify stage in /implement
**File:** `.claude/skills/implement/SKILL.md`
**Fixes:** the missing live-verification stage.

Add **Step 3.5 — Live verify (after the fix loop, before the final report):** when the plan's
changed set includes runtime surface (routes, UI pages, migrations), invoke the `verify` skill /
launch the app and drive the affected flow once. Minimum checklist baked into the step: pending
migrations applied (`db:migrate` — recurring error 2026-07-07: a running dev server does not
auto-apply them), the new route answers non-500, the new page renders its primary state. Failures
feed the fix loop like reviewer findings (bounded by the same `max-fix`). The final-report
template gains a `### Live verify` line (`passed | skipped (no runtime surface) | findings`).

**Acceptance:** the step + report line exist; skip condition is explicit so docs-only plans don't
launch the app.

### C2 — Measure on the next feature run
**Files:** none (process task).

Run the next lesson feature through the amended pipeline, then `/workflow-retro deep` and compare
its ledger row against `onboarding-generator` (22 agents / 8.2M cache-write / 60k planner output).
Success thresholds for a comparable-size feature: **agents ≤ 14**, **cache-write ≤ 6M**,
**planner output ≤ 40k**, parallelism ≥ 1.5× if the plan had a splittable orchestrator task, and
zero "verified manually because depcruise is missing" notes in implementer reports.

**Acceptance:** ledger row appended with the comparison in its recommendation column.

---

## Task order & risks
A1 → A2 → A3 → A4 → B1 → C1 (single session, sequential; ~30–60 min total), C2 on the next run.

- **Risk (A2/A3):** an inline task block can drift from the plan file if the orchestrator edits the
  plan mid-run — mitigated by keeping the plan path as authoritative fallback and requiring the
  orchestrator to re-paste after any plan amendment.
- **Risk (A1 merge rule):** over-merging recreates T10-style monoliths — the merge rule is bounded
  by "same directory, same Type, no mutual dependency, ≤ 4 tasks per bundle" and coexists with the
  10-step split rule.
- **Risk (B1):** pre-existing violations could make the gate red and untrusted — handled by the
  explicit known-exceptions step so it lands green.
- **Non-goal:** changing models per stage (Opus for spec/plan stays — quality there gated two
  blockers); changing the gate agents; touching product code.
