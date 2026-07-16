import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LLMProvider, GitHubReviewPayload, CiResultArtifact } from '@devdigest/shared';
import { reviewPullRequest, toReviewPayload, gateTriggered, countBlockers } from '@devdigest/reviewer-core';
import { findManifestPaths, loadAgentManifest } from './manifest.js';
import { loadSkillBodies } from './skills.js';
import { resolvePrContext, type CiEnv } from './context.js';
import { parseUnifiedDiff, stripIgnoredFiles } from './diff.js';
import { fetchPrDiff, postGithubReview, postPrComment, type FetchLike } from './github.js';
import { buildResultArtifact, buildResultBundle } from './artifact.js';
import { RunnerError } from './errors.js';

/**
 * `runCi` — the runner's single orchestration entry point (T8). Mirrors the
 * pipeline a local studio review runs (assemblePrompt/wrapUntrusted →
 * completeStructured → groundFindings, all INSIDE `reviewPullRequest`) so CI
 * and local stay in parity (AC-36): this file never re-implements or
 * hand-rolls any of that — it only resolves CI-specific inputs (manifest,
 * skills, diff, PR context) and hands them to the SAME reviewer-core engine
 * the studio calls, then turns the grounded result into GitHub side effects.
 *
 * Deterministic gate (AC-23): the GitHub review event + blocker count are
 * computed from `countBlockers`/`gateTriggered` + the manifest's `ci_fail_on`
 * against the GROUNDED findings — never from `review.verdict` (the model's
 * self-report), which is discarded here on purpose.
 *
 * Multi-agent: a repo may have more than one exported agent's manifest under
 * `.devdigest/agents/` (the studio already supports multi-agent PR review
 * locally — CI now matches that). The PR context + diff are shared, fetched
 * ONCE, and a failure resolving either is a hard, whole-run failure (Q5 —
 * there is nothing agent-specific to isolate yet). From there, EACH manifest
 * is loaded, reviewed, and posted INDEPENDENTLY: one agent's failure (bad
 * manifest, missing skill file, LLM error) is isolated to that agent — it is
 * recorded and contributes to a non-zero exit code, but never blocks its
 * siblings from running (a corrupted second manifest must not silently
 * swallow the first agent's review). All successful agents' artifacts are
 * combined into ONE `CiResultBundle` written to `resultPath`; if every agent
 * failed, nothing is written (preserves the original single-agent hard-fail
 * invariant: total failure → no artifact, no synthetic review skeleton).
 */

export type PostAs = 'github_review' | 'pr_comment' | 'none';

export interface RunCiDeps {
  /** Directory containing `agents/` and `skills/` (checked-in `.devdigest/`). */
  devdigestDir: string;
  env: CiEnv;
  /** Injected LLM provider — `OpenRouterProvider` in production, a stub in tests. */
  llm: LLMProvider;
  /** How to post the result — `'github_review' | 'pr_comment' | 'none'` (AC-24). */
  postAs: PostAs;
  /** Absolute path to write the combined `CiResultBundle` JSON to. */
  resultPath: string;
  fetchImpl?: FetchLike;
  readFile?: typeof readFileSync;
  readDir?: typeof readdirSync;
  writeFile?: typeof writeFileSync;
  now?: () => number;
  /**
   * Override diff retrieval (tests supply a fixture diff directly instead of
   * hitting the GitHub API). Defaults to `fetchPrDiff` via the GitHub REST API.
   */
  fetchDiff?: (
    ctx: { owner: string; repo: string; prNumber: number },
    token: string,
    fetchImpl: FetchLike,
  ) => Promise<string>;
}

export interface AgentRunSuccess {
  agentName: string;
  ok: true;
  artifact: CiResultArtifact;
  posted: { kind: PostAs; payload?: GitHubReviewPayload };
  blockers: number;
  gateTriggered: boolean;
}

export interface AgentRunFailure {
  /** The manifest's filename stem when the manifest itself failed to load;
   *  otherwise the manifest's declared `name`. */
  agentName: string;
  ok: false;
  error: string;
}

export type AgentRunOutcome = AgentRunSuccess | AgentRunFailure;

export interface RunCiSuccess {
  exitCode: number;
  agents: AgentRunOutcome[];
  error?: undefined;
}

export interface RunCiFailure {
  exitCode: number;
  agents: null;
  error: string;
}

export type RunCiResult = RunCiSuccess | RunCiFailure;

export async function runCi(deps: RunCiDeps): Promise<RunCiResult> {
  const readFile = deps.readFile ?? readFileSync;
  const readDir = deps.readDir ?? readdirSync;
  const writeFile = deps.writeFile ?? writeFileSync;
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const fetchDiffImpl = deps.fetchDiff ?? fetchPrDiff;

  let manifestPaths: string[];
  let ctx: ReturnType<typeof resolvePrContext>;
  let githubToken: string | undefined;
  let diff: ReturnType<typeof parseUnifiedDiff>;

  // Shared preconditions (Q5): a failure here aborts the ENTIRE run — no
  // agent-specific work has happened yet, so there is nothing to isolate.
  try {
    manifestPaths = findManifestPaths(deps.devdigestDir, { readFile, readDir });

    ctx = resolvePrContext(deps.env, readFile);

    githubToken = deps.env.GITHUB_TOKEN;
    if (deps.postAs !== 'none' && !githubToken) {
      throw new RunnerError(`GITHUB_TOKEN is required to post as '${deps.postAs}'`);
    }

    const rawDiff = await fetchDiffImpl(ctx, githubToken ?? '', fetchImpl);
    diff = parseUnifiedDiff(stripIgnoredFiles(rawDiff));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, agents: null, error: message };
  }

  const agents: AgentRunOutcome[] = [];

  for (const manifestPath of manifestPaths) {
    const agentStem = path.basename(manifestPath).replace(/\.ya?ml$/, '');
    try {
      // 1. Load + validate the manifest BEFORE it is used for anything (AC-20).
      const manifest = loadAgentManifest(manifestPath, { readFile });
      const skills = loadSkillBodies(deps.devdigestDir, manifest.skills, readFile);

      // 2. Run the SAME engine the studio uses. `reviewPullRequest` internally
      //    calls `assemblePrompt`/`wrapUntrusted` (diff → `<untrusted
      //    source="diff">`, prDescription → `<untrusted source="pr-description">`,
      //    AC-21) and the mandatory `groundFindings()` gate (AC-22).
      const start = now();
      const outcome = await reviewPullRequest({
        systemPrompt: manifest.system_prompt,
        model: manifest.model,
        diff,
        llm: deps.llm,
        strategy: manifest.strategy,
        skills,
        prDescription: ctx.body,
        task: `Review PR #${ctx.prNumber}: ${ctx.title}`,
      });
      const durationMs = now() - start;

      // 3. Deterministic verdict/gate from GROUNDED findings + `ci_fail_on`
      //    (AC-23) — never `outcome.review.verdict`.
      const payload = toReviewPayload(outcome.review, {
        failOn: manifest.ci_fail_on,
        diff,
        title: manifest.name,
      });
      const blockers = countBlockers(outcome.review.findings, manifest.ci_fail_on);
      const triggered = gateTriggered(outcome.review.findings, manifest.ci_fail_on);

      // 4. Build the artifact before posting, so a GitHub-side posting failure
      //    never loses the already-computed, already-grounded result.
      const artifact = buildResultArtifact({
        findings: outcome.review.findings,
        costUsd: outcome.costUsd,
        durationMs,
        agent: manifest.name,
        prNumber: ctx.prNumber,
      });

      // 5. Post per `post_as` (AC-24) — each agent posts its OWN review/comment;
      //    `toReviewPayload`'s title already carries `manifest.name`, so
      //    multiple agents' posts on the same PR are distinguishable.
      if (deps.postAs === 'github_review') {
        await postGithubReview(ctx, githubToken as string, payload, fetchImpl);
      } else if (deps.postAs === 'pr_comment') {
        await postPrComment(ctx, githubToken as string, payload.body, fetchImpl);
      }
      // 'none' → post nothing (exit-code only).

      agents.push({
        agentName: manifest.name,
        ok: true,
        artifact,
        posted: { kind: deps.postAs, payload },
        blockers,
        gateTriggered: triggered,
      });
    } catch (err) {
      // Hard-fail for THIS agent only (Q5, now per-agent): nothing posted and
      // no artifact contributed for it — but sibling agents still run.
      const message = err instanceof Error ? err.message : String(err);
      agents.push({ agentName: agentStem, ok: false, error: message });
    }
  }

  // 6. Write ONE combined bundle from every agent that produced a grounded
  //    result. Nothing written if all agents failed (AC-26/Q5, generalized).
  const succeeded = agents.filter((a): a is AgentRunSuccess => a.ok);
  if (succeeded.length > 0) {
    const bundle = buildResultBundle(succeeded.map((a) => a.artifact));
    writeFile(deps.resultPath, `${JSON.stringify(bundle, null, 2)}\n`);
  }

  // 7. Exit non-zero iff ANY agent hard-failed OR any agent's gate triggered
  //    REQUEST_CHANGES (AC-25, generalized to N agents).
  const anyFailure = agents.some((a) => !a.ok);
  const anyGateTriggered = succeeded.some((a) => a.gateTriggered);
  const exitCode = anyFailure || anyGateTriggered ? 1 : 0;

  return { exitCode, agents };
}
