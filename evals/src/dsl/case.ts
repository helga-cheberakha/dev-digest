/**
 * Case types + the runners that turn a data array into vitest tests. This module owns the ONE
 * true measure → (log) → assert body, so case authors never rewrite it — which is exactly what
 * keeps the "assert before record" bug from recurring once record() lands (T2 slots into the
 * marked spot below, in this one file).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { DEFAULT_THRESHOLD } from "../config.js";
import { skillTask, agentTask, workflowTask } from "../tasks.js";
import { runClaude, type Result, type RunOptions } from "../runtime/run-claude.js";
import { patternMatch } from "../scoring/pattern-match.js";
import { llmJudge, type Verdict } from "../scoring/llm-judge.js";
import { logTrace, logVerdict } from "../logging/log.js";
import { record } from "../records/record.js";
import { REPO_ROOT } from "../artifacts/paths.js";

// --- Guard against real repo mutation --------------------------------------

// workflowTask runs against the REAL on-disk repo (settingSources:["project"]), and `allowedTools`
// is NOT a hard boundary under permissionMode:"bypassPermissions" (run-claude.ts) — a workflow
// session has called `Write` directly even though WORKFLOW_ALLOWED_TOOLS never lists it. Confirmed
// twice: engineering-insights wrote a live entry into server/INSIGHTS.md (broke every later run of
// that case, which found its own prior entry and correctly declined to re-write it), and a separate
// run wrote a stray EXPORT_ENDPOINT_PLAN.md at the repo root that then misled every subsequent
// API-route run into reading it instead of the routed doc. A per-file snapshot can't cover an
// arbitrary new path, so diff the full `git status` before/after every case instead: anything that
// changed state during the case (new untracked path, or a previously-clean tracked file going
// dirty) gets removed/reverted in a `finally`, regardless of outcome. Pre-existing dirty/untracked
// paths (the user's own uncommitted work) are left untouched since their status line doesn't change.
function repoStatusLines(): Set<string> {
  const out = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: REPO_ROOT, encoding: "utf8" });
  return new Set(out.split("\n").filter(Boolean));
}

function cleanupNewChanges(before: Set<string>): void {
  for (const line of repoStatusLines()) {
    if (before.has(line)) continue; // pre-existing change, not this case's doing — leave it
    const status = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (status.includes("?")) {
      rmSync(join(REPO_ROOT, path), { recursive: true, force: true }); // new untracked path
    } else {
      execFileSync("git", ["checkout", "--", path], { cwd: REPO_ROOT }); // was clean, now dirty
    }
  }
}

// --- Case shapes ------------------------------------------------------------

/** A judge-and-grounding case. Same shape for skills and agents; only the task differs. */
export interface QualityCase {
  name: string;
  kind?: "quality" | "grounding";
  prompt: string;
  /** Practices the judge scores (quality). Omit for a pure grounding case. */
  practices?: string[];
  /** Substrings that must ALL appear before the judge runs (cheap-tier gate). */
  grounding?: string[];
  /** Judge score gate (default 0.6). */
  threshold?: number;
  maxTurns?: number;
}
export type SkillCase = QualityCase;
export type AgentCase = QualityCase;

/** A trace-asserted workflow case — a discriminated union routed by `kind`. */
export type WorkflowCase =
  | { kind: "dispatch"; name: string; prompt: string; expectSubagent: string; maxTurns?: number }
  | {
      kind: "activation";
      name: string;
      prompt: string;
      skill: string;
      shouldActivate: boolean;
      maxTurns?: number;
    }
  | {
      kind: "contrast";
      name: string;
      prompt: string;
      expectFileRead: string;
      tools?: string[];
      maxTurns?: number;
    }
  | {
      // A single-session composite: run ONE workflowTask and assert several trace facets at once.
      // Cheaper than separate dispatch/activation/contrast cases (one session, not N) at the cost
      // of coarser diagnostics and no control run — use contrast when you must isolate CLAUDE.md's
      // contribution. Every provided expectation must hold; omitted fields are not checked.
      kind: "trace";
      name: string;
      prompt: string;
      expectSubagents?: string[];
      expectSkills?: string[];
      /** Each entry is a required file; an entry that is itself a string[] is an "any of" group
       *  (e.g. docs that intentionally duplicate the same guidance — either one counts). */
      expectFilesRead?: (string | string[])[];
      /** Optional judged practices scored against result.text (e.g. "does not recommend X"). */
      practices?: string[];
      /** Judge score gate for `practices` (default 0.6). */
      threshold?: number;
      maxTurns?: number;
    };

/** Did a skill engage? Either an explicit Skill tool-call, or reading its SKILL.md. */
export function activated(result: Result, skill: string): boolean {
  const bySkill = result.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`));
  const byRead = result.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`));
  return bySkill || byRead;
}

/** A file-read expectation entry: a plain string is required; a string[] group passes if ANY
 *  member was read (for docs that intentionally duplicate the same guidance). */
function fileGroupRead(filesRead: string[], entry: string | string[]): boolean {
  const group = Array.isArray(entry) ? entry : [entry];
  return group.some((f) => filesRead.some((r) => r.includes(f)));
}

function fileGroupLabel(entry: string | string[]): string {
  return Array.isArray(entry) ? `any of [${entry.join(", ")}]` : entry;
}

// --- Runners ----------------------------------------------------------------

type Task = (prompt: string, artifact: string, opts?: RunOptions) => Promise<Result>;

function runQualityCases(artifact: string, cases: QualityCase[], task: Task): void {
  for (const c of cases) {
    test(c.name, async () => {
      const threshold = c.threshold ?? DEFAULT_THRESHOLD;
      const result = await task(c.prompt, artifact, { maxTurns: c.maxTurns });
      logTrace(c.name, result);

      // measure → record → assert. Everything measurable runs in the try; record() fires in the
      // finally with whatever accumulated; the asserts happen strictly after. A failing config
      // (e.g. baseline: grounding gate fails, judge skipped) still leaves a record.
      let grounded: number | undefined;
      let verdict: Verdict | undefined;
      try {
        // Cheap deterministic tier first — the grounding gate. When it fails the judge is skipped.
        if (c.grounding?.length) grounded = patternMatch(result.text, c.grounding);
        if (c.practices?.length && (grounded === undefined || grounded === 1)) {
          verdict = await llmJudge(result.text, c.practices);
          logVerdict(c.name, verdict);
        }
      } finally {
        record(c.name, { result, verdict, grounded, threshold });
      }

      if (grounded !== undefined) {
        expect(grounded, `missing concrete evidence; output:\n${result.text}`).toBe(1);
      }
      if (verdict) {
        expect(verdict.score, JSON.stringify(verdict.results)).toBeGreaterThanOrEqual(threshold);
      }
    });
  }
}

export const runSkillCases = (skill: string, cases: SkillCase[]) => runQualityCases(skill, cases, skillTask);
export const runAgentCases = (agent: string, cases: AgentCase[]) => runQualityCases(agent, cases, agentTask);

export function runWorkflowCases(cases: WorkflowCase[]): void {
  for (const c of cases) {
    test(c.name, async () => {
      const beforeStatus = repoStatusLines();
      try {
        if (c.kind === "dispatch") {
          // Stop the moment the subagent is launched — no need to wait out its nested session.
          const expect1 = c.expectSubagent;
          const result = await workflowTask(c.prompt, {
            maxTurns: c.maxTurns,
            stopWhen: (p) => p.subagents.includes(expect1),
          });
          logTrace(c.name, result);
          const passed = result.subagents.includes(c.expectSubagent);
          try {
            expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(c.expectSubagent);
          } finally {
            record(c.name, { result, assertionsPassed: passed });
          }
        } else if (c.kind === "activation") {
          const result = await workflowTask(c.prompt, { maxTurns: c.maxTurns });
          logTrace(c.name, result);
          const passed = activated(result, c.skill) === c.shouldActivate;
          try {
            expect(
              activated(result, c.skill),
              `skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
            ).toBe(c.shouldActivate);
          } finally {
            record(c.name, { result, assertionsPassed: passed });
          }
        } else if (c.kind === "trace") {
          // One session, many asserts — every provided expectation is checked against the same trace.
          // Stop as soon as ALL expectations are satisfied (e.g. doc read + subagent launched), so a
          // dispatch-bearing trace doesn't pay for the nested subagent's full run.
          const subs = c.expectSubagents ?? [];
          const skls = c.expectSkills ?? [];
          const files = c.expectFilesRead ?? [];
          const skillEngaged = (p: { skillsInvoked: string[]; filesRead: string[] }, skill: string) =>
            p.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`)) ||
            p.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`));
          // A judged case needs the model's actual final answer, not just its tool trace — stopWhen
          // breaks the loop right after the qualifying tool_use, before that answer is produced, so
          // skip early-stop entirely when practices are being scored.
          const result = await workflowTask(c.prompt, {
            maxTurns: c.maxTurns,
            stopWhen: c.practices?.length
              ? undefined
              : (p) =>
                  subs.every((s) => p.subagents.includes(s)) &&
                  skls.every((s) => skillEngaged(p, s)) &&
                  files.every((f) => fileGroupRead(p.filesRead, f)),
          });
          logTrace(c.name, result);
          // Same booleans the assertions below check, computed up front so record() gets the real
          // pass/fail even though the expect() calls below throw on the first failing one.
          const traceOk =
            subs.every((s) => result.subagents.includes(s)) &&
            skls.every((s) => skillEngaged(result, s)) &&
            files.every((f) => fileGroupRead(result.filesRead, f)) &&
            !result.isError;
          // Judged practices (if any) score result.text — computed inside the try so a failure
          // still leaves a record, asserted after the finally like the quality-case pattern.
          let verdict: Verdict | undefined;
          const threshold = c.threshold ?? DEFAULT_THRESHOLD;
          try {
            for (const sub of c.expectSubagents ?? []) {
              expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(sub);
            }
            for (const skill of c.expectSkills ?? []) {
              expect(
                activated(result, skill),
                `skill ${skill} not engaged | skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
              ).toBe(true);
            }
            for (const file of c.expectFilesRead ?? []) {
              expect(
                fileGroupRead(result.filesRead, file),
                `${fileGroupLabel(file)} not read | reads: ${result.filesRead.join(", ")}`,
              ).toBe(true);
            }
            expect(result.isError).toBe(false);
            if (c.practices?.length) {
              verdict = await llmJudge(result.text, c.practices);
              logVerdict(c.name, verdict);
            }
          } finally {
            record(c.name, {
              result,
              verdict,
              threshold: c.practices?.length ? threshold : undefined,
              assertionsPassed: traceOk,
            });
          }
          if (verdict) {
            expect(verdict.score, JSON.stringify(verdict.results)).toBeGreaterThanOrEqual(threshold);
          }
        } else {
          // contrast: treatment (real harness) vs control (empty tmpdir, no on-disk config).
          const tools = c.tools ?? ["Read", "Grep", "Glob"];
          const treatment = await workflowTask(c.prompt, { allowedTools: tools, maxTurns: c.maxTurns });
          const emptyCwd = mkdtempSync(join(tmpdir(), "eval-control-"));
          const control = await runClaude(c.prompt, {
            allowedTools: tools,
            maxTurns: c.maxTurns,
            cwd: emptyCwd,
            settingSources: [],
          });
          logTrace(`${c.name} [treatment]`, treatment);
          logTrace(`${c.name} [control]`, control);
          const treatmentRead = treatment.filesRead.some((f) => f.includes(c.expectFileRead));
          const controlRead = control.filesRead.some((f) => f.includes(c.expectFileRead));
          try {
            expect(treatmentRead, `treatment reads: ${treatment.filesRead.join(", ")}`).toBe(true);
            expect(controlRead, `control reads: ${control.filesRead.join(", ")}`).toBe(false);
          } finally {
            record(`${c.name} [treatment]`, { result: treatment, assertionsPassed: treatmentRead });
            record(`${c.name} [control]`, { result: control, assertionsPassed: !controlRead });
          }
        }
      } finally {
        cleanupNewChanges(beforeStatus);
      }
    });
  }
}
