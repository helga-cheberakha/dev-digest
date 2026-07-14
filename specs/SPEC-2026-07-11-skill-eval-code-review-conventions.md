# Spec: Regression Eval for the `code-review-conventions` Skill   |   Spec ID: SPEC-2026-07-11-skill-eval-code-review-conventions   |   Status: draft
Supersedes: none

## Problem & why
The `code-review-conventions` skill (`.claude/skills/code-review-conventions/SKILL.md`) — my own
skill, authored in Homework L02 — has no regression net. It defines a 4-level severity scale, a
6-field structured finding format, an adversarial-verification protocol for CRITICAL findings, a
"never blocks" downgrade list, and a suppression protocol. Any future edit to its description or
instructions (tightening wording, adding a rule, fixing a typo) can silently break one of these
behaviors, and the first sign would be a wrong verdict in a real PR review days later.

The `evals/` package (the Claude-Code harness-evals CI, distinct and unrelated to the in-progress
web Eval Dashboard feature under `specs/SPEC-2026-07-10-eval-pipeline.md`) already exercises three
other skills this way — `onion-architecture`, `security`, `dependency-checker` — each as a
`<skill>.eval.ts` + `<skill>.cases.ts` pair under `evals/skills/<skill>/`, auto-discovered by
Vitest's `**/*.eval.ts` glob and by CI's `ci-detect.mjs`. `code-review-conventions` is the one
skill of mine still missing this protection.

## Goals / Non-goals
- **Goal:** add `evals/skills/code-review-conventions/code-review-conventions.eval.ts` +
  `code-review-conventions.cases.ts`, following the exact 2-file pattern already established by
  the three existing skill evals — no framework changes.
- **Goal:** cover 3–4 cases, each targeting one distinct mechanic of the skill (severity
  calibration via adversarial verification, structured finding format, the "never blocks"
  downgrade list, the suppression protocol) — not just "does it produce a finding."
- **Goal:** use `grounding` (→ `patternMatch`) for cases whose expectation is a concrete,
  literal fact (e.g. the output must contain the token `LOW` or `suppressed`); use `practices`
  (→ `llmJudge`) for cases whose expectation is behavioral/qualitative (e.g. "the fix is concrete,
  not vague").
- **Goal:** run the suite for real, read the judge's verdicts and evidence quotes, and calibrate
  wording/thresholds so the green cases are green for the right reason (not by accident).
- **Goal:** prove the eval is load-bearing — deliberately break the skill (temporarily strip one
  documented rule from `SKILL.md`), confirm the corresponding case goes red, revert, confirm green
  again. This is a one-time manual verification step during implementation, not a new automated
  test.
- **Non-goal:** changes to `evals/vitest.config.ts`, `evals/scripts/ci-detect.mjs`, or
  `.github/workflows/harness-evals.yml` — the existing discovery glob and CI path filters already
  cover any new file under `evals/skills/code-review-conventions/`.
- **Non-goal:** the in-progress Eval Dashboard / `eval_cases` / `eval_runs` work
  (`specs/SPEC-2026-07-10-eval-pipeline.md`, `docs/plans/PLAN-eval-pipeline.md`) — unrelated
  package, unrelated mechanism (DB-backed, agent-tier, not skill-tier).
- **Non-goal:** eval-ing any other skill (`onion-architecture`, `security`, `dependency-checker`
  already have coverage; `frontend-architecture`, `pr-self-review`, `engineering-insights` are out
  of scope for this spec).
- **Non-goal:** populated fixture files. All three existing skill evals inline their fixture
  code/diffs as template-literal strings directly in `.cases.ts`; this spec follows that
  established convention rather than introducing `fixtureReader`-based external fixtures.
- **Non-goal:** rewording `SKILL.md` itself, except transiently during the break/revert
  verification step (reverted before the session ends) — unless calibration in Goal 4 surfaces a
  genuine ambiguity worth fixing for real, in which case it's called out explicitly, not silently
  bundled in.

## Acceptance criteria (EARS)
- **AC-1:** WHEN `evals/skills/code-review-conventions/code-review-conventions.eval.ts` exists and
  imports `describeSkill` + `runSkillCases` from `../../src/index.js` (matching the pattern in
  `onion-architecture.eval.ts`), THEN `pnpm --filter` (or `vitest run skills/code-review-conventions`
  from `evals/`) SHALL discover and execute the suite with no changes to `vitest.config.ts`.
- **AC-2:** The `cases.ts` file SHALL export `cases: SkillCase[]` with 3–4 entries, each targeting
  a distinct mechanic of the skill: (a) severity calibration under adversarial verification —
  a snippet that looks CRITICAL at first read but must be downgraded to HIGH after refutation, per
  the skill's own worked example in `examples.md`; (b) the structured 6-field finding format
  (`file`, `line`, `severity`, `skill`, `issue`, `fix`) for a genuine bug; (c) the "never blocks"
  downgrade list — a pure style/naming issue must not be classified as blocking CRITICAL; (d) the
  suppression protocol — a finding under a `// pr-self-review-ignore: <reason>` comment must still
  surface but as `suppressed`, not as a blocker.
- **AC-3:** EACH case with a concrete factual expectation (a literal severity label, a literal
  required-field marker, the literal word `suppressed`) SHALL express that expectation via
  `grounding: string[]` (scored by `patternMatch`, gates before the judge runs) rather than folding
  it into a `practices` entry.
- **AC-4:** EACH case with a qualitative/behavioral expectation (e.g. "downgrades after refutation
  because the ORM parameterizes the query," "the fix is concrete, not a vague 'consider
  refactoring'") SHALL express that expectation via `practices: string[]` (scored by `llmJudge`).
- **AC-5:** WHEN the suite is run against the current `SKILL.md`, ALL cases SHALL pass (green) at
  a calibrated `threshold` (no case may be tuned to pass by accident — evidence quotes from the
  judge output must genuinely support each passed practice).
- **AC-6:** WHEN one documented rule is deliberately removed from `SKILL.md` (e.g. the adversarial
  verification instruction, or the "never blocks" list), the corresponding case(s) SHALL fail
  (red). WHEN the removal is reverted, the suite SHALL return to green. This is demonstrated once
  during implementation and reported in the summary; no permanent "mutation test" artifact is
  added.
- **AC-7:** The new files SHALL NOT modify `evals/src/**`, `evals/vitest.config.ts`,
  `evals/scripts/ci-detect.mjs`, or any file outside
  `evals/skills/code-review-conventions/` and (transiently, per AC-6)
  `.claude/skills/code-review-conventions/SKILL.md`.

## Out of scope / open questions
- None blocking. If AC-6's break/revert step surfaces a genuine wording gap in `SKILL.md` (not
  just a contrived removal), it will be flagged to the user as a separate, explicit follow-up
  rather than folded silently into this change.

## Verification plan
1. `cd evals && pnpm eval:skills` (or scoped `vitest run skills/code-review-conventions`) — all
   cases green, judge evidence quotes reviewed manually for genuineness.
2. Temporarily strip one rule from `SKILL.md`, rerun — targeted case(s) red.
3. Revert, rerun — green again.
4. `pnpm eval:quality` (existing static skill-quality gate) — confirm it no longer warns about a
   missing eval file for `code-review-conventions`.
