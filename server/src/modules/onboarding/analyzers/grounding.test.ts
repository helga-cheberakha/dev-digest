/**
 * grounding.test.ts — unit tests for groundArtifact (AC-6)
 *
 * Oracle: AC-6 observable — "a stubbed hallucinated reference is stripped from
 * the output" while fact-based entries remain.
 */

import { describe, it, expect } from 'vitest';
import { groundArtifact } from './grounding.js';
import type { GroundingFactSet } from './grounding.js';
import type { OnboardingArtifact } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid OnboardingArtifact for test fixtures. */
function makeArtifact(
  overrides: Partial<OnboardingArtifact['sections']> = {},
): OnboardingArtifact {
  return {
    repoName: 'owner/repo',
    filesIndexed: 42,
    generatedAt: new Date().toISOString(),
    headSha: 'abc123',
    sections: {
      architecture: {
        overview: 'A layered architecture.',
        style: 'layered',
        diagram: {
          nodes: [],
          edges: [],
        },
      },
      criticalPaths: [],
      howToRun: [],
      readingPath: [],
      ...overrides,
    },
  };
}

const KNOWN_FILES: GroundingFactSet = {
  knownFiles:    new Set(['src/service.ts', 'src/utils.ts', 'src/index.ts']),
  knownPackages: new Set(['express', 'zod']),
  knownServices: new Set(['postgres', 'redis']),
};

// ---------------------------------------------------------------------------
// AC-6: hallucinated reference is stripped; fact-based entries remain
// ---------------------------------------------------------------------------

describe('groundArtifact — AC-6: strips hallucinated references', () => {
  it('strips a criticalPaths entry whose file is not in knownFiles', () => {
    // Observable: the hallucinated ref is absent from the output
    const artifact = makeArtifact({
      criticalPaths: [
        { file: 'src/service.ts',             rationale: 'real',         link: 'https://...' },
        { file: 'src/hallucinated-file.ts',   rationale: 'invented',     link: 'https://...' }, // hallucinated
      ],
    });

    const grounded = groundArtifact(artifact, KNOWN_FILES);

    const files = grounded.sections.criticalPaths.map((e) => e.file);
    expect(files).toContain('src/service.ts');
    expect(files).not.toContain('src/hallucinated-file.ts');
  });

  it('keeps criticalPaths entries whose file IS in knownFiles', () => {
    const artifact = makeArtifact({
      criticalPaths: [
        { file: 'src/service.ts', rationale: 'real', link: 'https://...' },
        { file: 'src/utils.ts',   rationale: 'real', link: 'https://...' },
      ],
    });

    const grounded = groundArtifact(artifact, KNOWN_FILES);

    expect(grounded.sections.criticalPaths).toHaveLength(2);
  });

  it('strips readingPath entries with hallucinated file refs', () => {
    const artifact = makeArtifact({
      readingPath: [
        { file: 'src/index.ts',        rationale: 'real',     link: 'https://...' },
        { file: 'src/phantom-stub.ts', rationale: 'invented', link: 'https://...' }, // hallucinated
      ],
    });

    const grounded = groundArtifact(artifact, KNOWN_FILES);

    const files = grounded.sections.readingPath.map((e) => e.file);
    expect(files).toContain('src/index.ts');
    expect(files).not.toContain('src/phantom-stub.ts');
  });

  it('strips firstTasks entries with hallucinated suggestedPaths', () => {
    const artifact = makeArtifact({
      firstTasks: [
        {
          title: 'Add tests for service.ts',
          suggestedPath: 'src/service.ts',   // known
          gapType: 'missing_test',
          rationale: 'No test file found.',
          patternPointer: 'add a *.test.ts',
          complexity: 'medium',
        },
        {
          title: 'Add tests for phantom.ts',
          suggestedPath: 'src/phantom.ts',   // hallucinated
          gapType: 'missing_test',
          rationale: 'Invented.',
          patternPointer: 'add a *.test.ts',
          complexity: 'low',
        },
      ],
    });

    const grounded = groundArtifact(artifact, KNOWN_FILES);

    const paths = (grounded.sections.firstTasks ?? []).map((t) => t.suggestedPath);
    expect(paths).toContain('src/service.ts');
    expect(paths).not.toContain('src/phantom.ts');
  });

  it('preserves absence of firstTasks when the LLM omitted the section', () => {
    const artifact = makeArtifact({ firstTasks: undefined });
    const grounded = groundArtifact(artifact, KNOWN_FILES);
    expect(grounded.sections.firstTasks).toBeUndefined();
  });

  it('strips architecture diagram nodes with hallucinated file ids', () => {
    const artifact = makeArtifact({
      architecture: {
        overview: 'overview',
        style: 'modular',
        diagram: {
          nodes: [
            { id: 'src/service.ts',      label: 'service.ts',   kind: 'file'  },
            { id: 'src/phantom.ts',       label: 'phantom.ts',   kind: 'file'  }, // hallucinated
            { id: 'express',              label: 'express',      kind: 'package' }, // known package
            { id: 'unknown-package',      label: 'unknown',      kind: 'package' }, // unknown package
          ],
          edges: [],
        },
      },
    });

    const grounded = groundArtifact(artifact, KNOWN_FILES);
    const nodeIds = grounded.sections.architecture.diagram.nodes.map((n) => n.id);
    expect(nodeIds).toContain('src/service.ts');
    expect(nodeIds).not.toContain('src/phantom.ts');
    expect(nodeIds).toContain('express');
    expect(nodeIds).not.toContain('unknown-package');
  });

  it('retains overflow nodes unconditionally (they are synthetic)', () => {
    const artifact = makeArtifact({
      architecture: {
        overview: 'overview',
        style: 'modular',
        diagram: {
          nodes: [
            { id: '__overflow__', label: '+4 more files', kind: 'overflow' },
          ],
          edges: [],
        },
      },
    });

    const grounded = groundArtifact(artifact, KNOWN_FILES);
    const nodeIds = grounded.sections.architecture.diagram.nodes.map((n) => n.id);
    expect(nodeIds).toContain('__overflow__');
  });

  it('removes edges whose from or to was stripped by grounding', () => {
    const artifact = makeArtifact({
      architecture: {
        overview: 'overview',
        style: 'layered',
        diagram: {
          nodes: [
            { id: 'src/service.ts', label: 'service.ts', kind: 'file' },
            { id: 'src/phantom.ts', label: 'phantom.ts', kind: 'file' }, // hallucinated
          ],
          edges: [
            { from: 'src/service.ts', to: 'src/phantom.ts' }, // phantom stripped → edge removed
            { from: 'src/index.ts',   to: 'src/service.ts' }, // both absent from nodes → removed
          ],
        },
      },
    });

    const grounded = groundArtifact(artifact, KNOWN_FILES);

    // After grounding nodes: only src/service.ts survives
    // Edges pointing to/from phantom.ts must be removed
    const edgesTo = grounded.sections.architecture.diagram.edges.map((e) => e.to);
    expect(edgesTo).not.toContain('src/phantom.ts');
  });

  it('passes through howToRun, metadata, and top-level flags unchanged', () => {
    const artifact = makeArtifact({
      howToRun: [{ step: 'Install dependencies', command: 'npm install' }],
    });
    const withFlags: OnboardingArtifact = { ...artifact, degraded: true, degradedReason: 'test' };

    const grounded = groundArtifact(withFlags, KNOWN_FILES);

    expect(grounded.degraded).toBe(true);
    expect(grounded.degradedReason).toBe('test');
    expect(grounded.sections.howToRun).toHaveLength(1);
    expect(grounded.sections.howToRun[0]?.command).toBe('npm install');
  });
});
