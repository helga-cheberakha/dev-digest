/**
 * Tests for context-loader — the Project Context doc assembler for agent runs.
 *
 * Covers the acceptance criteria from T8:
 *  - AC-10: dedup — a path on both agent and a skill appears once, at agent position
 *  - AC-12: skip + log missing paths; run still completes
 *  - AC-13: refuse symlink-escaping paths
 *  - AC-14: per-doc truncation with explicit marker
 *  - AC-15: total budget drop — within-budget prefix injected, remainder dropped + logged
 *  - AC-18: empty when no docs attached
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadContextDocs } from './context-loader.js';
import type { Container } from '../../platform/container.js';

// ---------------------------------------------------------------------------
// Fixture — a minimal clone directory with real files so guardPath can
// resolve real paths (realpath-based confinement check).
// ---------------------------------------------------------------------------

let cloneRoot: string;
let outsideDir: string;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'ctx-loader-test-'));
  cloneRoot = join(base, 'clone');
  outsideDir = join(base, 'outside');

  await mkdir(join(cloneRoot, 'specs'), { recursive: true });
  await mkdir(join(cloneRoot, 'docs'), { recursive: true });
  await mkdir(outsideDir, { recursive: true });

  // Happy-path files
  await writeFile(join(cloneRoot, 'specs', 'a.md'), 'real content a');
  await writeFile(join(cloneRoot, 'specs', 'b.md'), 'real content b');
  await writeFile(join(cloneRoot, 'docs', 'guide.md'), 'real content guide');
  await writeFile(join(cloneRoot, 'specs', 'large.md'), 'x'.repeat(25_000));

  // Symlink inside clone pointing outside (AC-13 symlink-escape fixture)
  await writeFile(join(outsideDir, 'secret.md'), 'top secret');
  await symlink(join(outsideDir, 'secret.md'), join(cloneRoot, 'docs', 'escaped.md'));
});

afterAll(async () => {
  if (cloneRoot) {
    await rm(join(cloneRoot, '..'), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Mock container builder
// The mock only implements the three methods called by loadContextDocs:
//   container.agentsRepo.documentsForAgent
//   container.skillsRepo.documentsForSkill
//   container.git.readFile
// ---------------------------------------------------------------------------

type ReadFileFn = (repo: { owner: string; name: string }, path: string) => Promise<string>;

function makeContainer(opts: {
  documentsForAgent?: (agentId: string) => Promise<string[]>;
  documentsForSkill?: (skillId: string) => Promise<string[]>;
  readFile?: ReadFileFn;
}): Container {
  return {
    agentsRepo: {
      documentsForAgent: opts.documentsForAgent ?? (async () => []),
    },
    skillsRepo: {
      documentsForSkill: opts.documentsForSkill ?? (async () => []),
    },
    git: {
      readFile:
        opts.readFile ??
        (async (_repo, path) => {
          throw new Error(`no mock content for ${path}`);
        }),
    },
  } as unknown as Container;
}

const repoRef = { owner: 'test', name: 'repo' };

/** Silent logger for the context loader under test. */
const silentLog = { info: () => undefined };

/** Logger that collects messages for assertions. */
function captureLog() {
  const messages: string[] = [];
  return {
    log: { info: (msg: string) => { messages.push(msg); } },
    messages,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadContextDocs', () => {
  // -------------------------------------------------------------------------
  // AC-18: empty when no docs attached
  // -------------------------------------------------------------------------
  it('returns empty result when no docs are attached (AC-18)', async () => {
    const container = makeContainer({
      documentsForAgent: async () => [],
    });

    const result = await loadContextDocs(
      container,
      cloneRoot,
      repoRef,
      'agent-1',
      [],
      silentLog,
    );

    expect(result.specs).toHaveLength(0);
    expect(result.specsRead).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.truncated).toHaveLength(0);
    expect(result.dropped).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AC-10: dedup — a path on both agent + skill appears once at agent position
  // -------------------------------------------------------------------------
  it('deduplicates paths — agent doc appears once at its agent position (AC-10)', async () => {
    // specs/a.md is in BOTH agent and skill; it should appear once, at its
    // agent position (first occurrence wins).
    const container = makeContainer({
      documentsForAgent: async () => ['specs/a.md', 'specs/b.md'],
      documentsForSkill: async () => ['specs/a.md', 'docs/guide.md'],
      readFile: async (_repo, path) => `mocked content of ${path}`,
    });

    const result = await loadContextDocs(
      container,
      cloneRoot,
      repoRef,
      'agent-1',
      ['skill-1'],
      silentLog,
    );

    // specs/a.md from the skill is dropped because specs/a.md (agent) was seen first
    expect(result.specsRead).toEqual(['specs/a.md', 'specs/b.md', 'docs/guide.md']);
    expect(result.specs).toHaveLength(3);
    // No skipped/dropped paths
    expect(result.skipped).toHaveLength(0);
    expect(result.dropped).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AC-12: skip missing path — run still completes
  // -------------------------------------------------------------------------
  it('skips a missing path and run still completes (AC-12)', async () => {
    // specs/missing.md does not exist on disk — guardPath will reject it
    // because realpath on a non-existent file throws ENOENT.
    const { log, messages } = captureLog();
    const container = makeContainer({
      documentsForAgent: async () => ['specs/a.md', 'specs/missing.md'],
      readFile: async (_repo, path) => `content of ${path}`,
    });

    const result = await loadContextDocs(
      container,
      cloneRoot,
      repoRef,
      'agent-1',
      [],
      log,
    );

    // The good path is included
    expect(result.specsRead).toContain('specs/a.md');
    // The missing path is NOT included
    expect(result.specsRead).not.toContain('specs/missing.md');
    // The missing path is in skipped
    expect(result.skipped).toContain('specs/missing.md');
    // The run returned a result (did not throw)
    expect(result.specs.length).toBeGreaterThan(0);
    // The skip was logged
    expect(messages.some((m) => m.includes('specs/missing.md'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AC-13: refuse symlink-escaping path
  // -------------------------------------------------------------------------
  it('refuses a symlink that escapes the clone root (AC-13)', async () => {
    // docs/escaped.md → outsideDir/secret.md (symlink created in beforeAll)
    const container = makeContainer({
      documentsForAgent: async () => ['docs/escaped.md'],
      readFile: async (_repo, path) => `content of ${path}`,
    });

    const result = await loadContextDocs(
      container,
      cloneRoot,
      repoRef,
      'agent-1',
      [],
      silentLog,
    );

    expect(result.specsRead).not.toContain('docs/escaped.md');
    expect(result.skipped).toContain('docs/escaped.md');
    expect(result.specs).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AC-14: per-doc truncation with explicit marker
  // -------------------------------------------------------------------------
  it('truncates a >20k doc with an explicit marker (AC-14)', async () => {
    const bigContent = 'x'.repeat(25_000);
    const container = makeContainer({
      documentsForAgent: async () => ['specs/large.md'],
      readFile: async () => bigContent,
    });

    const result = await loadContextDocs(
      container,
      cloneRoot,
      repoRef,
      'agent-1',
      [],
      silentLog,
    );

    expect(result.specsRead).toContain('specs/large.md');
    expect(result.truncated).toContain('specs/large.md');
    // The first 20 000 chars are preserved
    expect(result.specs[0]!.slice(0, 20_000)).toBe('x'.repeat(20_000));
    // The truncation marker is appended
    expect(result.specs[0]).toContain('[... document truncated at 20,000 characters ...]');
    // Nothing was dropped
    expect(result.dropped).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AC-15: total budget drop — within-budget prefix injected, remainder dropped
  // -------------------------------------------------------------------------
  it('drops docs past the total budget and logs the dropped paths (AC-15)', async () => {
    // Three docs of 15 000 chars each.
    // Budget = 40 000. First two fit (15 k + 15 k = 30 k). Third tips it over.
    const bigContent = 'y'.repeat(15_000);
    const { log, messages } = captureLog();
    const container = makeContainer({
      documentsForAgent: async () => ['specs/a.md', 'specs/b.md', 'docs/guide.md'],
      readFile: async () => bigContent,
    });

    const result = await loadContextDocs(
      container,
      cloneRoot,
      repoRef,
      'agent-1',
      [],
      log,
    );

    // First two docs are within budget
    expect(result.specsRead).toEqual(['specs/a.md', 'specs/b.md']);
    expect(result.specs).toHaveLength(2);
    // Third is dropped
    expect(result.dropped).toContain('docs/guide.md');
    expect(result.dropped).toHaveLength(1);
    // Dropped path was logged
    expect(messages.some((m) => m.includes('docs/guide.md') || m.includes('dropped'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Skill docs are appended after agent docs (ordering)
  // -------------------------------------------------------------------------
  it('appends skill docs after agent docs in skill order', async () => {
    const container = makeContainer({
      documentsForAgent: async () => ['specs/a.md'],
      documentsForSkill: async (id) =>
        id === 'skill-1' ? ['docs/guide.md'] : ['specs/b.md'],
      readFile: async (_repo, path) => `content of ${path}`,
    });

    const result = await loadContextDocs(
      container,
      cloneRoot,
      repoRef,
      'agent-1',
      ['skill-1', 'skill-2'],
      silentLog,
    );

    // Agent doc first, then skill-1 doc, then skill-2 doc
    expect(result.specsRead).toEqual(['specs/a.md', 'docs/guide.md', 'specs/b.md']);
  });
});
