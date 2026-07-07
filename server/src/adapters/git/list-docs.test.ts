/**
 * Unit tests for SimpleGitClient.listDocs — stat-only `.md` discovery walk.
 *
 * Creates a real temporary directory tree so we exercise the actual fs walk,
 * the maxFiles cap, and the symlink-skip safety property without any
 * network/git dependency.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SimpleGitClient } from './simple-git.js';

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

let tempBase: string;
const OWNER = 'test-owner';
const REPO = 'test-repo';
const REPO_REF = { owner: OWNER, name: REPO };

/** Absolute path of the fixture clone root. */
let cloneRoot: string;

beforeAll(async () => {
  // Layout: tempBase/<owner>/<repo>/...  — matches SimpleGitClient.clonePathFor
  tempBase = await mkdtemp(join(tmpdir(), 'dd-list-docs-'));
  cloneRoot = join(tempBase, OWNER, REPO);

  // Directories
  await mkdir(join(cloneRoot, 'specs'), { recursive: true });
  await mkdir(join(cloneRoot, 'docs'), { recursive: true });
  await mkdir(join(cloneRoot, 'insights'), { recursive: true });
  await mkdir(join(cloneRoot, 'src'), { recursive: true });
  await mkdir(join(cloneRoot, 'node_modules', 'foo'), { recursive: true });
  await mkdir(join(cloneRoot, 'deep', 'nested'), { recursive: true });

  // .md files that should be included
  await writeFile(join(cloneRoot, 'specs', 'overview.md'), 'spec content here');
  await writeFile(join(cloneRoot, 'docs', 'api.md'), 'api docs content');
  await writeFile(join(cloneRoot, 'insights', 'notes.md'), 'insights notes');
  await writeFile(join(cloneRoot, 'README.md'), 'root readme');
  await writeFile(join(cloneRoot, 'deep', 'nested', 'doc.md'), 'deep nested doc');

  // Non-.md file — must be excluded
  await writeFile(join(cloneRoot, 'src', 'app.ts'), 'typescript source');

  // .md file inside node_modules — must be excluded (skipped dir)
  await writeFile(join(cloneRoot, 'node_modules', 'foo', 'README.md'), 'npm pkg readme');
});

afterAll(async () => {
  await rm(tempBase, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SimpleGitClient.listDocs', () => {
  it('returns only .md files with POSIX-relative paths', async () => {
    const client = new SimpleGitClient(tempBase);
    const docs = await client.listDocs(REPO_REF);

    const paths = docs.map((d) => d.path).sort();

    // Expected inclusions
    expect(paths).toContain('specs/overview.md');
    expect(paths).toContain('docs/api.md');
    expect(paths).toContain('insights/notes.md');
    expect(paths).toContain('README.md');
    expect(paths).toContain('deep/nested/doc.md');

    // TypeScript file must be absent
    expect(paths).not.toContain('src/app.ts');

    // node_modules tree must be absent
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
  });

  it('reports correct sizeBytes (stat-only, no content opened by the method)', async () => {
    const client = new SimpleGitClient(tempBase);
    const docs = await client.listDocs(REPO_REF);

    const apiDoc = docs.find((d) => d.path === 'docs/api.md');
    expect(apiDoc).toBeDefined();
    // 'api docs content' is 16 bytes as UTF-8
    expect(apiDoc!.sizeBytes).toBe(Buffer.byteLength('api docs content', 'utf8'));
  });

  it('respects maxFiles cap — stops after N entries', async () => {
    const client = new SimpleGitClient(tempBase);
    const docs = await client.listDocs(REPO_REF, { maxFiles: 2 });
    expect(docs.length).toBe(2);
  });

  it('returns [] when the clone does not exist', async () => {
    const client = new SimpleGitClient(tempBase);
    const docs = await client.listDocs({ owner: 'ghost', name: 'repo' });
    expect(docs).toEqual([]);
  });

  it('skips symlinks — never follows them (even within-clone targets)', async () => {
    // Create a real .md file outside the clone and a symlink into it.
    const outsideFile = join(tempBase, 'outside.md');
    await writeFile(outsideFile, 'outside content');
    const symlinkInClone = join(cloneRoot, 'specs', 'symlink-doc.md');

    try {
      await symlink(outsideFile, symlinkInClone);
    } catch {
      // Symlink creation may be restricted in some CI environments — skip the
      // assertion rather than failing the suite on a platform limitation.
      return;
    }

    try {
      const client = new SimpleGitClient(tempBase);
      const docs = await client.listDocs(REPO_REF);

      // The symlink entry must NOT appear in results.
      const paths = docs.map((d) => d.path);
      expect(paths).not.toContain('specs/symlink-doc.md');
    } finally {
      await rm(symlinkInClone).catch(() => {});
    }
  });

  it('supports custom excludeDirs override', async () => {
    // Passing excludeDirs=[] means we no longer skip node_modules.
    const client = new SimpleGitClient(tempBase);
    const docs = await client.listDocs(REPO_REF, { excludeDirs: [] });

    const paths = docs.map((d) => d.path);
    // node_modules/foo/README.md should now be included.
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(true);
  });
});
