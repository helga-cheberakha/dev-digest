import { describe, it, expect } from 'vitest';
import type { Intent, BlastRadius, SmartDiff, IssueMeta } from '@devdigest/shared';
import {
  assembleBriefPayload,
  buildKnownPathSet,
  estimateTokens,
  BRIEF_TOKEN_BUDGET,
  type BriefFacts,
  type SpecDoc,
} from './assembler.js';

// ---- Fixtures ----

const intentFixture: Intent = {
  summary: 'Adds retry logic to the payment webhook handler.',
  in_scope: ['webhook retry', 'idempotency key'],
  out_of_scope: ['UI changes'],
};

const blastFixture: BlastRadius = {
  changed_symbols: [{ name: 'handleWebhook', file: 'src/webhooks/handler.ts', kind: 'function' }],
  downstream: [
    {
      symbol: 'handleWebhook',
      callers: [{ name: 'routeWebhook', file: 'src/webhooks/routes.ts', line: 10 }],
      endpoints_affected: ['POST /webhooks/payment'],
      crons_affected: [],
    },
  ],
  summary: '1 symbol changed, 1 downstream caller.',
};

const smartDiffFixture: SmartDiff = {
  groups: [
    {
      role: 'core',
      files: [
        {
          path: 'src/webhooks/handler.ts',
          pseudocode_summary: 'retry loop',
          additions: 20,
          deletions: 5,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 25, proposed_splits: [] },
};

const issueFixture: IssueMeta = {
  number: 42,
  title: 'Webhook retries drop events',
  body: 'When the payment provider retries, we sometimes drop events.',
  state: 'open',
};

/**
 * A diff-hunk-shaped fixture (unified diff format) — used to prove the
 * assembled payload contains no hunk STRUCTURE even when the raw text is fed
 * through a section builder path. Includes an `@@` header and paired +/- runs.
 */
const DIFF_HUNK_FIXTURE = [
  '@@ -12,7 +12,9 @@ function handleWebhook(req) {',
  '-  return process(req);',
  '+  return retry(process, req);',
  '+  // added retry wrapper',
  ' }',
].join('\n');

/** Markdown bullet lines (legal content) that must survive verbatim. */
const MARKDOWN_BULLETS = ['- retries on 5xx only', '- idempotency key required'].join('\n');

/**
 * Hunk-structure oracle: matches a `@@ -n,+m @@` header, OR a paired +/-
 * diff run — a `-`-prefixed line immediately followed by a `+`-prefixed
 * line, or vice versa (the alternating-sign "removal then addition"
 * pattern unique to unified diffs). Deliberately requires the SIGN to
 * alternate between the two lines, so two consecutive markdown bullets
 * (`- item one\n- item two`, same sign) never match — that is the
 * discriminating property a naive "line starts with -/+" regex lacks (M2).
 */
const HUNK_STRUCTURE_RE =
  /@@\s*-\d+(?:,\d+)?\s*\+\d+(?:,\d+)?\s*@@|^-[ \t].*\n\+[ \t]|^\+[ \t].*\n-[ \t]/m;

describe('assembleBriefPayload', () => {
  it('AC-2 / M2: the hunk-structure oracle is a valid positive control (matches a real diff hunk)', () => {
    // Sanity-check the oracle itself against the known diff-hunk fixture —
    // otherwise a vacuously-true "not.toMatch" assertion below would prove
    // nothing (M2's false-fail concern).
    expect(DIFF_HUNK_FIXTURE).toMatch(HUNK_STRUCTURE_RE);
  });

  it('AC-2 / M2: no hunk STRUCTURE in the assembled payload while markdown bullets survive verbatim', () => {
    // `BriefFacts` has no `diff`/`patch` field on any of its members (intent,
    // blast, smartDiff, linkedIssue, specs) — a real unified-diff hunk
    // structurally cannot enter the payload (assembler.ts's own guarantee).
    // This fixture proves that guarantee holds for realistic facts that
    // legitimately contain markdown bullet lines (`- text`) in multiple
    // places (intent in_scope/out_of_scope, spec content), which a naive
    // "no line starts with -/+" regex would also strip.
    const facts: BriefFacts = {
      intent: {
        summary: 'Some summary.\n' + MARKDOWN_BULLETS,
        in_scope: ['retries on 5xx only', 'idempotency key required'],
        out_of_scope: [],
      },
      blast: blastFixture,
      smartDiff: smartDiffFixture,
      linkedIssue: issueFixture,
      specs: [{ path: 'specs/SPEC-retry.md', content: `Retry policy:\n${MARKDOWN_BULLETS}` }],
    };

    const { userMessage } = assembleBriefPayload(facts);

    // No hunk structure anywhere in the real payload.
    expect(userMessage).not.toMatch(HUNK_STRUCTURE_RE);
    // Confirm the fixture text itself was never smuggled in (it wasn't fed
    // into any BriefFacts field — this pins the structural guarantee).
    expect(userMessage).not.toContain(DIFF_HUNK_FIXTURE);

    // Markdown bullet content survives verbatim in both the intent and spec
    // sections (a naive regex stripping all `-`/`+`-prefixed lines would
    // also destroy this — the discriminating assertion, M2).
    expect(userMessage).toContain('- retries on 5xx only');
    expect(userMessage).toContain('- idempotency key required');
    expect(userMessage.match(/- retries on 5xx only/g)).toHaveLength(3); // intent summary + in_scope + spec
  });

  it('AC-3 / M5: an inflated specs fixture is truncated so the estimate stays <= BRIEF_TOKEN_BUDGET, specs dropped first', () => {
    // Build enough spec content to blow well past the 7500-token budget.
    const bigSpecs: SpecDoc[] = Array.from({ length: 20 }, (_, i) => ({
      path: `specs/SPEC-${i}.md`,
      // ~2000 chars ≈ 500 tokens each × 20 = ~10000 tokens, well over budget.
      content: 'x'.repeat(2000),
    }));

    const facts: BriefFacts = {
      intent: intentFixture,
      blast: blastFixture,
      smartDiff: smartDiffFixture,
      linkedIssue: issueFixture,
      specs: bigSpecs,
    };

    const { estimatedTokens, specsDropped, userMessage } = assembleBriefPayload(facts);

    expect(estimatedTokens).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
    expect(specsDropped).toBe(true);
    // Core (non-spec) sections must survive the truncation — specs are
    // dropped first, never the intent/blast/smart-diff/issue sections.
    expect(userMessage).toContain('## Intent');
    expect(userMessage).toContain('## Blast radius');
    expect(userMessage).toContain('## Smart Diff');
    expect(userMessage).toContain('## Linked issue');
  });

  it('M5: an over-budget fixture with zero specs and a bloated blast section degrades core sections in reverse priority (issue, smart-diff, blast) and never drops intent', () => {
    // No specs at all — the spec-dropping pass has nothing to do, forcing
    // straight into the core-section degrade pass.
    const bloatedBlast: BlastRadius = {
      changed_symbols: Array.from({ length: 1000 }, (_, i) => ({
        name: `symbol${i}`,
        file: `src/module${i}/file${i}.ts`,
        kind: 'function',
      })),
      downstream: [],
      summary: 'Massive blast radius spanning the whole codebase.',
    };

    const facts: BriefFacts = {
      intent: intentFixture,
      blast: bloatedBlast,
      smartDiff: smartDiffFixture,
      linkedIssue: issueFixture,
      specs: [],
    };

    const { estimatedTokens, specsDropped, droppedSections, userMessage } =
      assembleBriefPayload(facts);

    // Confirms the fixture really was over budget pre-degrade (otherwise
    // droppedSections would be empty and this test would prove nothing).
    expect(droppedSections.length).toBeGreaterThan(0);
    expect(estimatedTokens).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
    expect(specsDropped).toBe(false); // there were no specs to drop
    // Degraded in REVERSE assembly priority: issue first, then smart-diff,
    // then (since the blast itself is what's oversized) blast too.
    expect(droppedSections).toEqual(['issue', 'smart-diff', 'blast']);
    expect(droppedSections).not.toContain('intent-truncated');

    // Intent — the highest-priority core fact — always survives, untouched.
    expect(userMessage).toContain('## Intent');
    expect(userMessage).toContain(intentFixture.summary);
    expect(userMessage).not.toContain('## Linked issue');
    expect(userMessage).not.toContain('## Smart Diff');
    expect(userMessage).not.toContain('## Blast radius');
  });

  it('M5: an intent section alone bigger than the whole budget is hard-sliced, never dropped', () => {
    const hugeIntent: Intent = {
      summary: 'x'.repeat(40000), // ~10000 tokens, alone over BRIEF_TOKEN_BUDGET
      in_scope: [],
      out_of_scope: [],
    };

    const facts: BriefFacts = { intent: hugeIntent };

    const { estimatedTokens, droppedSections, userMessage } = assembleBriefPayload(facts);

    expect(estimatedTokens).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
    expect(droppedSections).toEqual(['intent-truncated']);
    expect(userMessage).toContain('## Intent'); // intent section itself survives, shortened
  });

  it('AC-3: a payload under budget is not truncated (specsDropped stays false)', () => {
    const facts: BriefFacts = {
      intent: intentFixture,
      specs: [{ path: 'specs/SPEC-small.md', content: 'A short spec.' }],
    };

    const { specsDropped, userMessage, estimatedTokens } = assembleBriefPayload(facts);

    expect(specsDropped).toBe(false);
    expect(estimatedTokens).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
    expect(userMessage).toContain('specs/SPEC-small.md');
  });

  it('NF-UNTRUSTED: each untrusted region (intent summary, issue title/body, spec content) is delimited/wrapped', () => {
    const facts: BriefFacts = {
      intent: intentFixture,
      linkedIssue: issueFixture,
      specs: [{ path: 'specs/SPEC-a.md', content: 'Spec body text.' }],
    };

    const { userMessage } = assembleBriefPayload(facts);

    // wrapUntrusted renders `<untrusted source="label">\n...\n</untrusted>`.
    expect(userMessage).toContain('<untrusted source="intent-summary">');
    expect(userMessage).toContain(intentFixture.summary);
    expect(userMessage).toContain('<untrusted source="linked-issue-title">');
    expect(userMessage).toContain(issueFixture.title);
    expect(userMessage).toContain('<untrusted source="linked-issue-body">');
    expect(userMessage).toContain(issueFixture.body);
    expect(userMessage).toContain('<untrusted source="spec-specs/SPEC-a.md">');
    expect(userMessage).toContain('Spec body text.');
    expect(userMessage).toContain('</untrusted>');
  });

  it('blast/smart-diff sections ARE wrapped as untrusted — they interpolate PR-author-controlled file paths and symbol names', () => {
    const facts: BriefFacts = { blast: blastFixture, smartDiff: smartDiffFixture };
    const { userMessage } = assembleBriefPayload(facts);

    expect(userMessage).toContain('<untrusted source="blast-radius">');
    expect(userMessage).toContain('<untrusted source="smart-diff">');
    // Header/scaffolding stays outside the wrap; the identifier-bearing
    // content itself (changed symbol name, file path) is delimited as data.
    expect(userMessage).toContain('## Blast radius (deterministic)');
    expect(userMessage).toContain('## Smart Diff (deterministic)');
    expect(userMessage).toContain('handleWebhook');
    expect(userMessage).toContain('src/webhooks/handler.ts');
  });

  it('assembles no sections for empty facts and returns a well-formed empty payload', () => {
    const { userMessage, estimatedTokens, specsDropped } = assembleBriefPayload({});

    expect(specsDropped).toBe(false);
    expect(estimatedTokens).toBeGreaterThan(0); // header text always present
    expect(userMessage).toContain('Why+Risk Brief Generation');
  });
});

describe('estimateTokens', () => {
  it('uses a chars/4 heuristic', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('')).toBe(0);
    // ceil, not floor/round
    expect(estimateTokens('abc')).toBe(1);
  });
});

describe('buildKnownPathSet', () => {
  it('unions Blast changed-symbol files + downstream caller files with Smart-Diff group files', () => {
    const set = buildKnownPathSet(blastFixture, smartDiffFixture);

    expect(set.has('src/webhooks/handler.ts')).toBe(true); // blast changed symbol + smart-diff
    expect(set.has('src/webhooks/routes.ts')).toBe(true); // blast downstream caller
    expect(set.size).toBe(2);
  });

  it('returns an empty set when both inputs are absent', () => {
    expect(buildKnownPathSet(null, null).size).toBe(0);
    expect(buildKnownPathSet(undefined, undefined).size).toBe(0);
  });

  it('handles blast-only and smart-diff-only inputs', () => {
    expect(buildKnownPathSet(blastFixture, null).size).toBe(2);
    expect(buildKnownPathSet(null, smartDiffFixture).size).toBe(1);
  });
});
