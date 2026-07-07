/**
 * Tests for the path-guard confinement helper (T2 — AC-8, AC-13).
 *
 * Covers:
 *  - Traversal via `..`
 *  - Absolute paths
 *  - Non-`.md` files
 *  - Paths outside a configured root folder
 *  - A symlink inside the clone root that points outside it (symlink escape)
 *  - Happy-path `.md` files under each configured root folder
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardPath } from './path-guard.js';

// ---------------------------------------------------------------------------
// Fixture: a minimal clone directory used for real-path tests
// ---------------------------------------------------------------------------

let cloneRoot: string;
let outsideDir: string;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'path-guard-test-'));
  cloneRoot = join(base, 'clone');
  outsideDir = join(base, 'outside');

  // Create the clone root with the expected folder structure
  await mkdir(join(cloneRoot, 'specs'), { recursive: true });
  await mkdir(join(cloneRoot, 'docs'), { recursive: true });
  await mkdir(join(cloneRoot, 'insights'), { recursive: true });
  await mkdir(outsideDir, { recursive: true });

  // A legitimate .md file in each root folder
  await writeFile(join(cloneRoot, 'specs', 'api.md'), '# API spec');
  await writeFile(join(cloneRoot, 'docs', 'guide.md'), '# Guide');
  await writeFile(join(cloneRoot, 'insights', 'notes.md'), '# Notes');

  // A .md file outside the root (to confirm non-root rejection)
  await writeFile(join(cloneRoot, 'README.md'), '# Readme');

  // A non-.md file inside a root folder
  await writeFile(join(cloneRoot, 'specs', 'schema.ts'), 'export type Foo = {}');

  // A symlink inside docs/ pointing to a file outside the clone root
  await writeFile(join(outsideDir, 'secret.md'), 'top secret');
  await symlink(
    join(outsideDir, 'secret.md'),
    join(cloneRoot, 'docs', 'escaped.md'),
  );
});

afterAll(async () => {
  if (cloneRoot) {
    const base = join(cloneRoot, '..');
    await rm(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Rejection cases
// ---------------------------------------------------------------------------

describe('guardPath — rejections', () => {
  it('rejects path traversal via ".."', async () => {
    const result = await guardPath('../../etc/passwd', cloneRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/traversal/i);
    }
  });

  it('rejects absolute UNIX paths', async () => {
    const result = await guardPath('/etc/hosts', cloneRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/absolute/i);
    }
  });

  it('rejects non-.md files (TypeScript source)', async () => {
    const result = await guardPath('src/app.ts', cloneRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/\.md/i);
    }
  });

  it('rejects non-.md files inside a root folder', async () => {
    const result = await guardPath('specs/schema.ts', cloneRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/\.md/i);
    }
  });

  it('rejects a .md file at the root (not inside a root folder)', async () => {
    const result = await guardPath('README.md', cloneRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/specs|docs|insights/i);
    }
  });

  it('rejects a .md file under an unlisted folder', async () => {
    const result = await guardPath('src/notes.md', cloneRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/specs|docs|insights/i);
    }
  });

  it('rejects a symlink inside the clone that escapes to outside the clone root', async () => {
    // docs/escaped.md is a symlink → outsideDir/secret.md
    const result = await guardPath('docs/escaped.md', cloneRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/symlink|outside|resolves/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Happy-path cases
// ---------------------------------------------------------------------------

describe('guardPath — happy paths', () => {
  it('accepts a .md file under specs/', async () => {
    const result = await guardPath('specs/api.md', cloneRoot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe('specs/api.md');
    }
  });

  it('accepts a .md file under docs/', async () => {
    const result = await guardPath('docs/guide.md', cloneRoot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe('docs/guide.md');
    }
  });

  it('accepts a .md file under insights/', async () => {
    const result = await guardPath('insights/notes.md', cloneRoot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe('insights/notes.md');
    }
  });

  it('normalises to POSIX path (forward slashes)', async () => {
    const result = await guardPath('specs/api.md', cloneRoot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).not.toContain('\\');
    }
  });

  it('accepts a nested .md file under a root folder', async () => {
    // Create a nested file for this test
    await mkdir(join(cloneRoot, 'docs', 'sub'), { recursive: true });
    await writeFile(join(cloneRoot, 'docs', 'sub', 'deep.md'), '# Deep');
    const result = await guardPath('docs/sub/deep.md', cloneRoot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe('docs/sub/deep.md');
    }
  });
});
