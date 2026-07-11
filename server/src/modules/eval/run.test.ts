import { describe, it, expect, vi } from 'vitest';
import { runCase } from './run.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A single-file diff that the grounding gate can validate.
 * The `+` line (stripeKey) falls on new-side line 11; the context lines
 * occupy lines 10 and 12. Any finding on lines 10-12 in src/config.ts passes.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/**
 * A Review fixture whose one finding lands on line 12 of the diff above, so
 * the citation-grounding gate keeps it (line 12 is a context line in the hunk,
 * covered by new-side line numbers [10, 11, 12]).
 */
const REVIEW_WITH_FINDING = {
  verdict: 'comment',
  summary: 'Hardcoded secret detected.',
  score: 70,
  findings: [
    {
      id: 'f1',
      severity: 'WARNING',
      category: 'security',
      title: 'Hardcoded stripe key',
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
      rationale: 'stripeKey appears to be a live secret.',
      confidence: 0.95,
    },
  ],
};

/** A Review fixture with no findings — grounding trivially passes. */
const EMPTY_REVIEW = {
  verdict: 'approve',
  summary: 'No issues found.',
  score: 95,
  findings: [],
};

/**
 * Minimal AgentRow for tests — matches the DB schema shape (all non-nullable
 * fields included). Cast with `as AgentRow` to satisfy Drizzle-inferred types.
 */
const AGENT = {
  id: 'agent-id-1',
  workspaceId: 'ws-id-1',
  name: 'Test Agent',
  description: 'test description',
  provider: 'openai' as const,
  model: 'gpt-4o',
  systemPrompt: 'You are a code reviewer.',
  outputSchema: null,
  strategy: 'single-pass' as const,
  ciFailOn: 'critical' as const,
  repoIntel: true,
  enabled: true,
  version: 1,
  createdBy: null,
  createdAt: new Date('2026-01-01'),
} as AgentRow;

// ---------------------------------------------------------------------------
// Container factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock container that:
 * - Returns the given LLMProvider from `container.llm()`.
 * - Spies on `container.repoIntel` so tests can assert it is never accessed.
 */
function makeContainer(llmMock: MockLLMProvider): {
  container: Container;
  repoIntelAccess: ReturnType<typeof vi.fn>;
} {
  const repoIntelAccess = vi.fn();

  const container = {
    llm: async (_: unknown) => llmMock,
  } as unknown as Container;

  // Install a spy getter so tests can verify repoIntel is never touched.
  Object.defineProperty(container, 'repoIntel', {
    enumerable: true,
    configurable: true,
    get() {
      repoIntelAccess();
      // Return a proxy that throws on any method access so a bug would surface
      // immediately rather than producing a cryptic downstream error.
      return new Proxy(
        {},
        {
          get(_t, prop) {
            throw new Error(
              `repoIntel.${String(prop)} must not be called in the eval run path`,
            );
          },
        },
      );
    },
  });

  return { container, repoIntelAccess };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runCase', () => {
  it('returns { findings, kept, produced } with correct shape and values', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_WITH_FINDING });
    const { container } = makeContainer(llm);

    const result = await runCase(container, AGENT, [], { inputDiff: DIFF });

    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('kept');
    expect(result).toHaveProperty('produced');

    // The one finding on line 12 passes the grounding gate (line 12 is covered
    // by the hunk's new-side line numbers).
    expect(result.kept).toBe(1);
    expect(result.produced).toBeGreaterThanOrEqual(result.kept);
    expect(result.findings).toHaveLength(result.kept);
  });

  it('handles an empty inputDiff without throwing and returns zero findings', async () => {
    const llm = new MockLLMProvider('openai', { structured: EMPTY_REVIEW });
    const { container } = makeContainer(llm);

    const result = await runCase(container, AGENT, [], { inputDiff: '' });

    expect(result.findings).toEqual([]);
    expect(result.kept).toBe(0);
    expect(result.produced).toBe(0);
  });

  it('handles a null inputDiff without throwing', async () => {
    const llm = new MockLLMProvider('openai', { structured: EMPTY_REVIEW });
    const { container } = makeContainer(llm);

    const result = await runCase(container, AGENT, [], { inputDiff: null });

    expect(result.findings).toEqual([]);
    expect(result.kept).toBe(0);
  });

  it('never accesses container.repoIntel during a run', async () => {
    const llm = new MockLLMProvider('openai', { structured: EMPTY_REVIEW });
    const { container, repoIntelAccess } = makeContainer(llm);

    await runCase(container, AGENT, [], { inputDiff: DIFF });

    expect(repoIntelAccess).not.toHaveBeenCalled();
  });

  it('produces byte-identical prompt assembly across two runs with an unchanged agent', async () => {
    // Run 1
    const llm = new MockLLMProvider('openai', { structured: EMPTY_REVIEW });
    const { container } = makeContainer(llm);

    await runCase(container, AGENT, ['## Rule: No var\nPrefer const.'], {
      inputDiff: DIFF,
    });
    const call1 = llm.calls.find((c) => c.method === 'completeStructured');

    // Reset recorded calls and run again with identical inputs.
    llm.calls.splice(0);
    await runCase(container, AGENT, ['## Rule: No var\nPrefer const.'], {
      inputDiff: DIFF,
    });
    const call2 = llm.calls.find((c) => c.method === 'completeStructured');

    // `messages` contains the fully assembled prompt (system + user). If any
    // non-deterministic enrichment (repo-intel, timestamps, etc.) had crept in,
    // the JSON would differ between runs. An identical JSON string proves the
    // eval run path is pure and frozen.
    const msgs1 = (call1?.req as { messages: unknown }).messages;
    const msgs2 = (call2?.req as { messages: unknown }).messages;

    expect(JSON.stringify(msgs2)).toBe(JSON.stringify(msgs1));
  });

  it('includes costUsd from the mock provider outcome', async () => {
    // MockLLMProvider.completeStructured returns costUsd: 0.001 per call.
    // runCase must thread it through from ReviewOutcome to EvalRunOutput.
    const llm = new MockLLMProvider('openai', { structured: REVIEW_WITH_FINDING });
    const { container } = makeContainer(llm);

    const result = await runCase(container, AGENT, [], { inputDiff: DIFF });

    expect(result).toHaveProperty('costUsd');
    // A single-pass review makes exactly one completeStructured call at 0.001 each.
    expect(result.costUsd).toBe(0.001);
  });

  it('includes skillBodies in the assembled user prompt when provided', async () => {
    const llm = new MockLLMProvider('openai', { structured: EMPTY_REVIEW });
    const { container } = makeContainer(llm);

    const SKILL = '## Rule: Prefer const over var\nAlways use const.';
    await runCase(container, AGENT, [SKILL], { inputDiff: '' });

    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const messages = (call?.req as { messages: Array<{ content: string }> }).messages;
    // assemblePrompt places skills in the user message (messages[1]) under
    // "## Skills / rules", not the system message (messages[0]).
    const userContent = messages[1]?.content ?? '';
    expect(userContent).toContain('## Rule: Prefer const over var');
  });
});
