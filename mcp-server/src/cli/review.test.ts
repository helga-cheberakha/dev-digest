/**
 * Integration tests for the pre-review pipeline (no real git, no real LLM).
 *
 * Strategy (plan T4, simpler path):
 *   hardcoded raw-diff string → parseUnifiedDiff → reviewPullRequest (MockLLMProvider)
 *   → resolveExitCode assertion.
 *
 * The MockLLMProvider returns a canned Review fixture that the grounding gate
 * must keep.  The fixture's file/line must intersect a real hunk in the diff —
 * the raw diff below is crafted so line 2 of 'src/index.ts' is an added line.
 *
 * No real git process, no real LLM call, no Fastify server, no database.
 */
import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '@devdigest/server/adapters/git/diff-parser.js';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { MockLLMProvider } from '@devdigest/server/adapters/mocks.js';
import { resolveExitCode } from './output.js';

// ---------------------------------------------------------------------------
// Shared diff fixture
// ---------------------------------------------------------------------------

/**
 * A minimal one-file unified diff.
 * Hunk: @@ -1,3 +1,4 @@
 *   line 1 (context): 'import express from "express";'
 *   line 2 (addition): 'const SECRET = "sk_live_xxx";'
 *   line 3 (context): 'const app = express();'
 *   line 4 (context): 'app.listen(3000);'
 *
 * newLineNumbers will be [1, 2, 3, 4], so a finding at start_line=2 passes
 * the citation-grounding gate.
 */
const RAW_DIFF = [
  'diff --git a/src/index.ts b/src/index.ts',
  '--- a/src/index.ts',
  '+++ b/src/index.ts',
  '@@ -1,3 +1,4 @@',
  ' import express from "express";',
  '+const SECRET = "sk_live_xxx";',
  ' const app = express();',
  ' app.listen(3000);',
].join('\n');

// ---------------------------------------------------------------------------
// Review fixtures (validated by MockLLMProvider against the Review Zod schema)
// ---------------------------------------------------------------------------

const CRITICAL_REVIEW = {
  verdict: 'request_changes',
  summary: 'A hardcoded secret was found.',
  score: 15,
  findings: [
    {
      id: 'finding-001',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded live secret key',
      file: 'src/index.ts',
      start_line: 2,
      end_line: 2,
      rationale:
        'The string "sk_live_xxx" appears to be a live secret key committed directly into source code.',
      suggestion: 'Remove the hardcoded value and load it from process.env or a secrets manager.',
      confidence: 0.97,
    },
  ],
};

const EMPTY_REVIEW = {
  verdict: 'approve',
  summary: 'No issues found in this diff.',
  score: 95,
  findings: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pre-review pipeline integration', () => {
  it('resolveExitCode returns 1 when mock LLM returns a CRITICAL finding and failOn="critical"', async () => {
    const llm = new MockLLMProvider('openai', { structured: CRITICAL_REVIEW });
    const diff = parseUnifiedDiff(RAW_DIFF);

    const outcome = await reviewPullRequest({
      systemPrompt: 'You are a code reviewer.',
      model: 'gpt-4',
      diff,
      llm,
      strategy: 'single-pass',
      task: 'Pre-review integration test',
    });

    // The CRITICAL finding must survive the grounding gate (line 2 is in the diff hunk).
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]?.severity).toBe('CRITICAL');

    // The exit-code gate should trip on CRITICAL when failOn="critical".
    expect(resolveExitCode(outcome.review.findings, 'critical')).toBe(1);
  });

  it('resolveExitCode returns 0 when mock LLM returns no findings', async () => {
    const llm = new MockLLMProvider('openai', { structured: EMPTY_REVIEW });
    const diff = parseUnifiedDiff(RAW_DIFF);

    const outcome = await reviewPullRequest({
      systemPrompt: 'You are a code reviewer.',
      model: 'gpt-4',
      diff,
      llm,
      strategy: 'single-pass',
      task: 'Pre-review integration test',
    });

    expect(outcome.review.findings).toHaveLength(0);

    // No findings → exit code 0 for any policy.
    expect(resolveExitCode(outcome.review.findings, 'critical')).toBe(0);
    expect(resolveExitCode(outcome.review.findings, 'any')).toBe(0);
  });
});
