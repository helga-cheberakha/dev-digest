# Plan: Regression Eval for the `code-review-conventions` Skill
> Status: READY
> Date: 2026-07-11
> Author: main thread (no implementer subagent — 2-file, single-package scope)
> Spec: specs/SPEC-2026-07-11-skill-eval-code-review-conventions.md

## Overview

Add `evals/skills/code-review-conventions/code-review-conventions.eval.ts` +
`code-review-conventions.cases.ts`, the same 2-file pattern already used by the three existing
skill evals (`onion-architecture`, `security`, `dependency-checker`). No framework file changes —
Vitest's `**/*.eval.ts` glob and CI's `ci-detect.mjs` already cover any new directory under
`evals/skills/`. The work is one task: write the 4 cases, run them for real against a live model
via the Claude Code subscription backend (`EVAL_BACKEND` defaults to `subscription`, no API key
needed), read the judge's evidence quotes, calibrate wording/thresholds, then prove the suite is
load-bearing with a deliberate break → red → revert → green pass.

Given the size (2 new files, no cross-module contract, no DB/UI touch), this runs directly in the
main thread rather than through implementer/architecture-reviewer/plan-verifier — those gates
exist for multi-file, multi-module changes; here there's nothing for a second agent to reconcile.

## Requirements → Task coverage

| Requirement (from spec) | Task |
|---|---|
| AC-1: discovered by existing Vitest glob, no config changes | T1 |
| AC-2: 4 cases, each a distinct skill mechanic | T1 |
| AC-3: concrete facts → `grounding` | T1 |
| AC-4: qualitative/behavioral → `practices` | T1 |
| AC-5: all cases green at a calibrated threshold, evidence genuinely supports each pass | T2 |
| AC-6: break → red → revert → green, demonstrated once | T3 |
| AC-7: no files touched outside `evals/skills/code-review-conventions/` (+ transient SKILL.md in T3) | T1–T3 |

## Scope

### Modules affected
- [x] `evals` — two new files under `evals/skills/code-review-conventions/`
- [ ] everything else — not touched (transient edit to `.claude/skills/code-review-conventions/SKILL.md` in T3 is reverted before completion)

### Explicitly out of scope
- `evals/vitest.config.ts`, `evals/scripts/ci-detect.mjs`, `.github/workflows/harness-evals.yml`
- Populated `fixtures/` files — all fixture code is inlined in `.cases.ts` template literals, matching the established convention (confirmed: none of the 3 existing skill evals use external fixture files, only `.gitkeep` placeholders)
- Any other skill's eval coverage
- The in-progress `SPEC-2026-07-10-eval-pipeline.md` / `PLAN-eval-pipeline.md` (Eval Dashboard feature — unrelated package, explicitly out of scope there too)
- Permanent changes to `SKILL.md` (T3's edit is reverted; if calibration surfaces a genuine wording gap, it's flagged separately, not bundled in)

---

## Implementation Tasks

### T1: Write the eval pair

**Files to touch**

| File | Action |
|---|---|
| `evals/skills/code-review-conventions/code-review-conventions.eval.ts` | create |
| `evals/skills/code-review-conventions/code-review-conventions.cases.ts` | create |
| `evals/skills/code-review-conventions/fixtures/.gitkeep` | create (matches sibling skills' convention, not read at runtime) |

**`code-review-conventions.eval.ts`** (identical 4-line pattern to the 3 existing skill evals):
```ts
import { describeSkill, runSkillCases } from "../../src/index.js";
import { cases } from "./code-review-conventions.cases.js";

describeSkill("code-review-conventions", () => runSkillCases("code-review-conventions", cases));
```

**`code-review-conventions.cases.ts`** — 4 cases, each isolating one mechanic from `SKILL.md`.
Each fixture is a fresh scenario (not a copy of `examples.md`'s worked examples) so the suite
tests whether the skill *generalizes* its own rules, not whether the model has memorized the
skill's own illustration.

1. **`severity calibration: adversarial verification downgrades a misleading log line, not the parameterized query`**
   Fixture: a Drizzle-backed lookup where a `console.log` template-literal makes it *look* like
   raw SQL interpolation, while the actual executed query uses `eq()` (auto-parameterized) —
   isolates the "skeptic pass before a CRITICAL blocks" rule (SKILL.md "Adversarial Verification
   Protocol").
   ```ts
   prompt: `Review this diff to server/src/modules/agents/repository.ts and report any issues with severity.

   \`\`\`ts
   import { db } from "../../db/client.js";
   import { agents } from "../../db/schema.js";
   import { eq } from "drizzle-orm";

   export async function findAgentsByOwner(ownerId: string) {
     console.log(\`fetching agents: SELECT * FROM agents WHERE owner_id = '\${ownerId}'\`);
     return db.select().from(agents).where(eq(agents.ownerId, ownerId));
   }
   \`\`\``,
   grounding: ["drizzle", "parameteriz"],
   practices: [
     "the answer does not classify this as a blocking CRITICAL SQL-injection vulnerability, because the interpolated string only appears inside the console.log call and the actual database query uses Drizzle's eq(), which parameterizes values automatically",
     "the answer explicitly performs a skeptic/adversarial check on the initial 'looks like SQL injection' impression — asking whether the query itself is actually built via string concatenation — before settling on a severity, rather than immediately labeling the console.log line as CRITICAL and stopping",
     "any issue raised about the console.log line is scoped to it being a misleading or unnecessary log statement (at most HIGH after downgrade, or LOW/MEDIUM), not command or query injection",
   ],
   threshold: 0.6,
   maxTurns: 10,
   ```

2. **`structured finding format: all six required fields present for a verified null-dereference bug`**
   Fixture: a route handler that dereferences a possibly-null repository result — directly
   mirrors the skill's own CRITICAL definition ("verified bug ... correctness breakage that
   affects production behaviour") — isolates the 6-field `Finding Format` rule.
   ```ts
   prompt: `Review this diff to server/src/modules/agents/routes.ts and report your finding using this project's structured finding format (file, line, severity, skill, issue, fix) — not a prose summary.

   \`\`\`ts
   fastify.delete("/agents/:id", async (request, reply) => {
     const agent = await agentsRepository.findById(request.params.id);
     await agentsRepository.delete(agent.id);
     return reply.status(204).send();
   });
   \`\`\``,
   grounding: ["file", "line", "severity", "skill", "issue", "fix", "CRITICAL"],
   practices: [
     "the finding's issue field states specifically that agentsRepository.findById can return null/undefined when no agent matches the id, and that calling .id on that result throws a runtime error",
     "the finding's fix field gives a concrete remediation such as returning a 404 when agent is null/undefined, not a vague statement like 'add error handling'",
   ],
   threshold: 0.7,
   maxTurns: 10,
   ```

3. **`never blocks: pure naming issue on a touched line stays LOW, not CRITICAL`**
   Fixture: a renamed/introduced variable with a non-descriptive name and explicitly no
   correctness risk — isolates the `What Never Blocks` downgrade list (style/naming).
   ```ts
   prompt: `Review this diff to server/src/modules/agents/stats.ts. Assume agentId is already validated by the caller — there is no null/undefined risk here. Report any issues with severity.

   \`\`\`ts
   export async function getAgentStats(agentId: string) {
     const x = await agentsRepository.findById(agentId);
     return { count: x.runCount, lastRun: x.lastRunAt };
   }
   \`\`\``,
   grounding: ["LOW"],
   practices: [
     "the answer identifies the variable name 'x' as a style/naming concern rather than a correctness issue",
     "the answer does not classify this finding as CRITICAL or as something that blocks the PR",
   ],
   threshold: 0.6,
   maxTurns: 10,
   ```

4. **`suppression protocol: a valid pr-self-review-ignore comment marks the finding suppressed, not dropped`**
   Fixture: a shell-out with a validated URL and a suppression comment carrying a reason —
   isolates the `Suppression` rule (finding stays visible as `suppressed`, requires a reason).
   ```ts
   prompt: `Review this diff to server/src/modules/repos/clone.service.ts and report any issues, including how this project's process would treat the marked line.

   \`\`\`ts
   export async function cloneRepo(repoUrl: string) {
     await execFile("git", ["clone", repoUrl]); // pr-self-review-ignore: repoUrl comes from the GitHub webhook payload, already validated as a github.com URL by validateRepoUrl()
   }
   \`\`\``,
   grounding: ["suppressed", "pr-self-review-ignore"],
   practices: [
     "the answer states that a finding on the marked line is not silently dropped but is still recorded/reported, just removed from the blocking set and marked as suppressed because of the pr-self-review-ignore comment",
     "the answer notes the suppression is valid because the comment includes a reason, not just the bare directive",
   ],
   threshold: 0.6,
   maxTurns: 10,
   ```

**Tests**
- No `.test.ts` — this *is* the test suite (Vitest discovers `*.eval.ts` directly).

**Definition of done**
- [x] Both files created, matching the established 2-file pattern exactly (import path, `describeSkill` wrapper)
- [x] `cd evals && npx tsc --noEmit` (or equivalent typecheck) passes
- [x] `evals/skills/code-review-conventions/fixtures/.gitkeep` created for convention parity

---

### T2: Run, read verdicts, calibrate

**Approach**
1. `cd evals && pnpm vitest run skills/code-review-conventions` (or `pnpm eval:skills` scoped via `-t`).
2. For every case, read the judge's per-practice `evidence` quotes (not just the pass/fail
   boolean). A practice that "passes" without a verbatim quote that actually supports it is a
   miscalibrated practice — reword it or split it.
3. For the two `grounding`-gated cases (1, 2, 4 all have grounding — actually 1, 2, 3, 4 all do),
   confirm the gate is doing real work: temporarily check that removing an expected term from the
   fixture (mentally, not literally) would plausibly fail it — i.e. the grounding tokens are
   specific enough not to trivially match boilerplate.
4. Adjust `threshold` only if a genuinely-correct response is failing a miscalibrated practice —
   never lower a threshold just to force green.

**Definition of done**
- [x] All 4 cases pass
- [x] Judge evidence quotes reviewed and screenshotted/noted as genuinely supporting each pass (spot-checked in the session, not just trusted blindly)
- [x] `pnpm eval:quality` (static skill-quality gate) no longer warns about a missing eval file for `code-review-conventions`

---

### T3: Break it, watch it go red, revert, watch it go green

**Approach**
1. Temporarily edit `.claude/skills/code-review-conventions/SKILL.md`: remove the entire
   `## Adversarial Verification Protocol` section (the rule Case 1 depends on).
2. Rerun `vitest run skills/code-review-conventions` — Case 1 (and likely others that lean on
   calibrated severity judgment) should go red.
3. `git checkout -- .claude/skills/code-review-conventions/SKILL.md` to revert.
4. Rerun — full suite green again.
5. Report the before/after (which case(s) went red, why) in the session summary — this is the
   evidence the eval is load-bearing, not just decorative.

**Definition of done**
- [x] Red run captured (case name + failure reason)
- [x] `git status` clean on `SKILL.md` after revert (confirmed via `git diff --stat`)
- [x] Green run confirmed after revert

---

## Risks

- **LLM non-determinism:** a single run passing doesn't guarantee stability. If a case flakes
  across 2–3 reruns, it's a signal to either raise `grounding` specificity or reword a `practices`
  entry — not to lower the threshold.
- **Grounding token collisions:** short tokens like `"file"` or `"LOW"` risk incidental substring
  matches (e.g. "file" inside "profile"). Given the prompts explicitly ask for the structured
  format / severity label, this is low-risk here, but T2's calibration pass should watch for it.
- **Cost/time:** 4 cases × (1 skill-task call + up to 1 judge call each) via the Claude Code
  subscription backend — no API billing, but real wall-clock time (`maxTurns: 10`,
  `testTimeout: 400_000`ms per the shared `vitest.config.ts`).

## Global definition of done
- [x] `evals/skills/code-review-conventions/{code-review-conventions.eval.ts,code-review-conventions.cases.ts}` exist and pass `vitest run skills/code-review-conventions`
- [x] No files outside `evals/skills/code-review-conventions/` remain modified (SKILL.md reverted)
- [x] Break → red → revert → green demonstrated and reported
- [x] Requirements → Task coverage table fully covered
- [x] Plan marked `Status: READY`

---

## Session summary (T2 + T3 results)

### T2 — stability confirmation
3 consecutive full-suite runs, all 4/4 green (12/12 tests total), no threshold or wording changes
needed beyond what was already in `code-review-conventions.cases.ts`:

| Run | severity calibration | structured format | never blocks | suppression |
|---|---|---|---|---|
| 1 (16:54) | ✓ | ✓ | ✓ | ✓ |
| 2 (16:56) | ✓ | ✓ | ✓ | ✓ |
| 3 (16:58) | ✓ | ✓ | ✓ | ✓ |

`pnpm eval:quality` reports `code-review-conventions [PASS]` (previously WARNed on missing eval
file). Judge evidence quotes were genuine in all 3 runs (e.g. severity case: `"severity": "HIGH"`
+ an explicit Drizzle-parameterization rationale, not a bare pass).

One caveat surfaced during the T3 sequence below (not a T2 regression, but worth recording): a
later, unrelated rerun of the reverted (clean) `SKILL.md` produced one grounding miss — the model
rated the naming-issue case `MEDIUM` instead of the literal token `LOW`. Severity was still
correctly non-blocking, so the *behavior* was right; only the exact-token `grounding: ["LOW"]`
gate missed it. This is pre-existing flakiness (also visible in the ~40-run calibration history
from the prior session), not something introduced by T3. Left as-is per the plan's own guidance
("never lower a threshold just to force green") — a future tightening could add `MEDIUM` as an
alternate grounding token if this recurs.

### T3 — break / revert, two attempts

**Attempt 1 — removed `## Adversarial Verification Protocol`.** Expected case 1 (severity
calibration) to go red. Result: **stayed green**. Full 4/4 pass. Inspecting the raw model output
showed the model still correctly reasoned that Drizzle's `eq()` parameterizes the query and
downgraded severity to LOW on its own — general model competence reaches the same conclusion
without needing that specific SKILL.md section spelled out. **Finding:** case 1, as currently
written, does not exclusively depend on the Adversarial Verification Protocol text; a capable
model derives the same verdict from first principles. Not a defect in the eval (AC-5/AC-6 are
still met via the case below), but a genuine scope note for anyone tightening this suite further.
Reverted with `git checkout --`.

**Attempt 2 — removed `## Suppression`.** Expected case 4 (suppression protocol) to go red.
Result: **red, as expected** — 3/4 passed, case 4 failed 0/2 practices (`expected 0 to be
greater than or equal to 0.6`). Both practice checks came back with empty evidence: without the
skill's documented `pr-self-review-ignore` convention, the model had no project-specific basis for
saying a suppressed finding stays `suppressed` rather than being dropped. This is the load-bearing
proof for AC-6 — the suite genuinely depends on `SKILL.md` content for at least one case.
Reverted with `git checkout --`; confirmed `git status --porcelain` clean on the file.

**Post-revert verification.** Reran full suite once more after the attempt-2 revert: 4/4 green
(`Tests 4 passed (4)`, 196s). `SKILL.md` confirmed clean in `git status` throughout — no stray
edits left behind.

**Takeaway:** the eval suite is load-bearing overall (proven via the suppression-protocol case),
but not uniformly so — case 1 currently tests correct severity *outcome*, not specifically
whether the model used the documented adversarial-verification *mechanism* to get there. Flagged
here per the plan's own AC-6 caveat rather than silently bundled in; no SKILL.md wording changes
were made as a result — left for a future, explicit follow-up if tighter isolation of case 1 is
wanted.
