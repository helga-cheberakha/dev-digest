/**
 * Unit tests for SimpleGitClient.writeFile — temp+rename atomic write.
 *
 * Creates a real temporary directory that mimics a clone root so we exercise
 * the actual filesystem write, the atomicity guarantee (no partial file), and
 * the round-trip readFile consistency — without any git/network dependency.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile as writeFileNative } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SimpleGitClient } from './simple-git.js';

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

let tempBase: string;
const OWNER = 'test-owner';
const REPO = 'test-write';
const REPO_REF = { owner: OWNER, name: REPO };

/** Absolute path of the fixture clone root. */
let cloneRoot: string;

beforeAll(async () => {
  // Layout: tempBase/<owner>/<repo>/...  — matches SimpleGitClient.clonePathFor
  tempBase = await mkdtemp(join(tmpdir(), 'dd-write-file-'));
  cloneRoot = join(tempBase, OWNER, REPO);

  // Seed a directory structure with existing .md files (writeFile targets must exist).
  await mkdir(join(cloneRoot, 'docs'), { recursive: true });
  await writeFileNative(join(cloneRoot, 'docs', 'overview.md'), 'original content');
  await writeFileNative(join(cloneRoot, 'README.md'), 'root readme');
});

afterAll(async () => {
  await rm(tempBase, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SimpleGitClient.writeFile', () => {
  it('writes content to an existing file and readFile returns the new content', async () => {
    const client = new SimpleGitClient(tempBase);
    const path = 'docs/overview.md';
    const newContent = '# Updated overview\n\nNew paragraph.';

    await client.writeFile(REPO_REF, path, newContent);
    const read = await client.readFile(REPO_REF, path);

    expect(read).toBe(newContent);
  });

  it('overwrites a root-level file and preserves exact UTF-8 content', async () => {
    const client = new SimpleGitClient(tempBase);
    const path = 'README.md';
    const content = '# README\n\nCafé — unicode works: ☕';

    await client.writeFile(REPO_REF, path, content);
    const read = await client.readFile(REPO_REF, path);

    expect(read).toBe(content);
  });

  it('leaves no temp file behind after a successful write', async () => {
    const client = new SimpleGitClient(tempBase);
    const path = 'docs/overview.md';

    await client.writeFile(REPO_REF, path, 'clean write check');

    // There should be no .tmp_ files anywhere under the clone root.
    const allFiles = await listAllFiles(cloneRoot);
    const tmpFiles = allFiles.filter((f) => f.includes('.tmp_'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('write then re-read is consistent across multiple sequential writes', async () => {
    const client = new SimpleGitClient(tempBase);
    const path = 'docs/overview.md';

    await client.writeFile(REPO_REF, path, 'first write');
    expect(await client.readFile(REPO_REF, path)).toBe('first write');

    await client.writeFile(REPO_REF, path, 'second write');
    expect(await client.readFile(REPO_REF, path)).toBe('second write');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all file paths under `dir`. */
async function listAllFiles(dir: string): Promise<string[]> {
  const { readdir: readdirFs } = await import('node:fs/promises');
  const entries = await readdirFs(dir, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listAllFiles(full)));
    } else if (entry.isFile()) {
      paths.push(full);
    }
  }
  return paths;
}
