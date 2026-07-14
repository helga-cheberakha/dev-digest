/**
 * Persist one eval run. Every case — passing OR failing — leaves a durable record: the verdict
 * with its per-practice evidence, the grounding result, resource metrics, the trace, git
 * provenance, and the configuration it ran under. The full model output is written alongside so
 * it can be re-read (or re-judged) later instead of being thrown away.
 *
 * `results/` is gitignored and append-only — deleting it is always safe.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { EVAL_CONFIG } from "../config.js";
import { RESULTS_DIR } from "../artifacts/paths.js";
import { gitInfo } from "../git.js";
import type { Result } from "../runtime/run-claude.js";
import type { Verdict } from "../scoring/llm-judge.js";

const RECORDS = join(RESULTS_DIR, "records.jsonl");
const OUTPUTS = join(RESULTS_DIR, "outputs");

// One id per process (per vitest run), same format as the trend reporter.
const RUN_ID = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
const { sha: GIT_SHA, dirty: DIRTY } = gitInfo();

const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "case";

export interface RecordData {
  result: Result;
  verdict?: Verdict;
  grounded?: number;
  threshold?: number;
  /**
   * Pass/fail from the case's own trace assertions (expectFilesRead, expectSubagents, activation
   * match, etc.), computed by the caller BEFORE `expect()` can throw. When provided, this is
   * authoritative over `!result.isError` — isError alone only reflects SDK-level completion and
   * says nothing about whether the case's real assertions held (a run can finish cleanly without
   * ever reading the expected file).
   */
  assertionsPassed?: boolean;
  extra?: Record<string, unknown>;
}

/**
 * Append a record for the currently-running test. Call from a `finally` so it fires even when
 * the assertions that follow it throw — that is what keeps a failing configuration's series
 * from being silently empty.
 */
export function record(label: string, data: RecordData): void {
  const { result, verdict, grounded, threshold, assertionsPassed, extra } = data;
  // Build nodeid from testPath + label, NOT expect.getState().currentTestName: that's a live
  // global that vitest mutates as soon as the NEXT test starts. A slow case (e.g. one that
  // dispatches a nested subagent) can still be awaiting its `finally` block after vitest has
  // already moved the global test-name pointer to a different test, silently mislabeling this
  // record under someone else's nodeid.
  const nodeid = `${expect.getState().testPath ?? "?"} > ${label}`;

  // outcome: grounding gate failure short-circuits to false; else the judge threshold; else the
  // caller's own trace-assertion result; else "did the run itself succeed" (isError alone — the
  // weakest signal, since a clean SDK completion says nothing about whether expected files were
  // actually read or a subagent actually dispatched).
  const outcome =
    grounded !== undefined && grounded < 1
      ? false
      : verdict && threshold !== undefined
        ? verdict.score >= threshold
        : assertionsPassed !== undefined
          ? assertionsPassed
          : !result.isError;

  const outDir = join(OUTPUTS, RUN_ID);
  mkdirSync(outDir, { recursive: true });
  const outputFile = join("outputs", RUN_ID, `${slugify(label)}.md`);
  writeFileSync(join(RESULTS_DIR, outputFile), result.text);

  const row = {
    schema: 1,
    run_id: RUN_ID,
    git_sha: GIT_SHA,
    dirty: DIRTY,
    config: EVAL_CONFIG,
    nodeid,
    label,
    outcome,
    score: verdict?.score,
    threshold,
    practices: verdict?.results ?? [],
    grounded,
    num_turns: result.numTurns,
    metrics: result.metrics,
    trace: {
      tools: result.toolsUsed,
      subagents: result.subagents,
      skills: result.skillsInvoked,
      reads: result.filesRead,
    },
    output_file: outputFile,
    ...extra,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  appendFileSync(RECORDS, JSON.stringify(row) + "\n");
}
