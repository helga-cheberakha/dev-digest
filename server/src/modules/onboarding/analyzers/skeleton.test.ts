/**
 * skeleton.test.ts — unit tests for buildSkeleton (AC-8)
 *
 * Oracle: AC-8 observable — "a degraded/un-indexed repo returns a skeleton
 * with the degraded flag set"; specifically the non-JS / empty-import-graph
 * degraded fixture that exercises the directory/entrypoint fallback, and it
 * passes `OnboardingArtifact.parse()`.
 */

import { describe, it, expect } from 'vitest';
import { buildSkeleton } from './skeleton.js';
import type { SkeletonInput } from './skeleton.js';
import { OnboardingArtifact } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE: SkeletonInput = {
  repoName: 'owner/repo',
  headSha: 'abc123',
  filesIndexed: 0,
  fullName: 'owner/repo',
  howToRun: [],
  topLevelDirs: [],
  readingSeeds: [],
};

// ---------------------------------------------------------------------------
// AC-8: valid skeleton + degraded flag
// ---------------------------------------------------------------------------

describe('buildSkeleton — AC-8: valid skeleton with degraded flag', () => {
  it('produces a skeleton that passes OnboardingArtifact.parse() even with 0-entry sections', () => {
    // Observable (critical): the skeleton must be schema-conforming even when
    // all sections are empty arrays (no .min() constraint).
    const skeleton = buildSkeleton({ ...BASE, degraded: true });

    expect(() => OnboardingArtifact.parse(skeleton)).not.toThrow();
  });

  it('sets degraded: true when the caller requests a degraded skeleton', () => {
    // Observable: degraded flag is set on the artifact.
    const skeleton = buildSkeleton({ ...BASE, degraded: true, degradedReason: 'No index' });

    expect(skeleton.degraded).toBe(true);
    expect(skeleton.degradedReason).toBe('No index');
  });

  it('has all five required sections present', () => {
    // Observable: 5 sections — even a degraded skeleton is non-empty at the section level.
    const skeleton = buildSkeleton({ ...BASE, degraded: true });

    expect(skeleton.sections).toHaveProperty('architecture');
    expect(skeleton.sections).toHaveProperty('criticalPaths');
    expect(skeleton.sections).toHaveProperty('howToRun');
    expect(skeleton.sections).toHaveProperty('readingPath');
    // firstTasks is optional — present or absent is fine on degraded path
    expect(Object.keys(skeleton.sections)).toContain('architecture');
  });

  it('omits firstTasks on the degraded path (no genuine gap detection performed)', () => {
    // AC-13 / AC-8: firstTasks must not be fabricated on the skeleton path.
    const skeleton = buildSkeleton({ ...BASE, degraded: true });
    expect(skeleton.sections.firstTasks).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC-8: non-JS / empty-import-graph degraded fixture — directory/entrypoint fallback
// ---------------------------------------------------------------------------

describe('buildSkeleton — AC-8: non-JS empty-import-graph — directory/entrypoint fallback', () => {
  it('uses top-level directories as architecture nodes when the import graph is empty', () => {
    // Non-JS repo: no architectureNodes from the index.
    // Fallback: topLevelDirs → architecture nodes.
    const skeleton = buildSkeleton({
      ...BASE,
      degraded: true,
      degradedReason: 'Non-JS repo — no import graph available',
      topLevelDirs: ['src', 'docs', 'tests', 'scripts'],
      readingSeeds: ['README.md', 'package.json'],
    });

    const nodeLabels = skeleton.sections.architecture.diagram.nodes.map((n) => n.label);
    expect(nodeLabels).toContain('src');
    expect(nodeLabels).toContain('docs');
    expect(nodeLabels).toContain('tests');
    expect(nodeLabels).toContain('scripts');
  });

  it('uses readingSeeds as reading-path entries when the reading path is empty', () => {
    // Fallback: readingSeeds → reading path entries.
    const skeleton = buildSkeleton({
      ...BASE,
      degraded: true,
      topLevelDirs: [],
      readingSeeds: ['README.md', 'Cargo.toml'],
    });

    const files = skeleton.sections.readingPath.map((e) => e.file);
    expect(files).toContain('README.md');
    expect(files).toContain('Cargo.toml');
  });

  it('uses readingSeeds as critical-path entries when critical paths are empty', () => {
    const skeleton = buildSkeleton({
      ...BASE,
      degraded: true,
      topLevelDirs: [],
      readingSeeds: ['src/main.py', 'requirements.txt'],
    });

    const files = skeleton.sections.criticalPaths.map((e) => e.file);
    expect(files).toContain('src/main.py');
    expect(files).toContain('requirements.txt');
  });

  it('reading-path seeds include a link constructed from fullName + headSha', () => {
    const skeleton = buildSkeleton({
      ...BASE,
      fullName: 'my-org/my-repo',
      headSha: 'cafebabe',
      degraded: true,
      topLevelDirs: [],
      readingSeeds: ['README.md'],
    });

    const entry = skeleton.sections.readingPath[0];
    expect(entry?.link).toContain('my-org/my-repo');
    expect(entry?.link).toContain('cafebabe');
    expect(entry?.link).toContain('README.md');
  });

  it('passes OnboardingArtifact.parse() for the non-JS empty-import-graph fixture', () => {
    // Core AC-8 check: even this fully-degraded, directory-heuristic skeleton is schema-valid.
    const skeleton = buildSkeleton({
      ...BASE,
      degraded: true,
      degradedReason: 'Non-JS repo — no import graph',
      topLevelDirs: ['src', 'tests'],
      readingSeeds: ['README.md'],
      howToRun: [{ step: 'Install', command: 'pip install -r requirements.txt' }],
    });

    expect(() => OnboardingArtifact.parse(skeleton)).not.toThrow();
  });

  it('caps architecture nodes at 8 even when more than 8 directories are provided', () => {
    const skeleton = buildSkeleton({
      ...BASE,
      degraded: true,
      topLevelDirs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], // 10 dirs
      readingSeeds: [],
    });

    expect(skeleton.sections.architecture.diagram.nodes.length).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// narrativeUnavailable flag (LLM-failure path, not the same as degraded)
// ---------------------------------------------------------------------------

describe('buildSkeleton — narrativeUnavailable flag (LLM-failure path)', () => {
  it('sets narrativeUnavailable: true when instructed', () => {
    const skeleton = buildSkeleton({ ...BASE, narrativeUnavailable: true });

    expect(skeleton.narrativeUnavailable).toBe(true);
    expect(skeleton.degraded).toBeUndefined();
  });

  it('still passes OnboardingArtifact.parse() on the narrativeUnavailable path', () => {
    const skeleton = buildSkeleton({ ...BASE, narrativeUnavailable: true });
    expect(() => OnboardingArtifact.parse(skeleton)).not.toThrow();
  });

  it('prefers analyzer-provided architectureNodes over directory fallback on narrativeUnavailable path', () => {
    // On LLM-failure path we may still have index facts; prefer them.
    const skeleton = buildSkeleton({
      ...BASE,
      narrativeUnavailable: true,
      architectureNodes: [
        { id: 'src/service.ts', label: 'service.ts', kind: 'file' },
      ],
      topLevelDirs: ['src', 'tests'], // should not be used since analyzer nodes are present
    });

    const labels = skeleton.sections.architecture.diagram.nodes.map((n) => n.label);
    expect(labels).toContain('service.ts');
    expect(labels).not.toContain('src');
    expect(labels).not.toContain('tests');
  });
});
