/**
 * Tests for ProjectContextService (T7 + T4 — AC-1, AC-2, AC-3, AC-4, AC-8, AC-9,
 * AC-30, AC-31, AC-32).
 *
 * Covers:
 *  - Discovery: filtering to context root folders only (AC-1).
 *  - Discovery: stat-only (no file content opened, AC-2).
 *  - Discovery: empty state + reason on missing clone (AC-3).
 *  - Discovery: cap at 500 + truncated flag (AC-4).
 *  - Preview: confined path returns content (AC-8).
 *  - Preview: traversal / escaping path returns rejection (AC-8).
 *  - Save: valid write echoes content (AC-30, AC-31).
 *  - Save: traversal / absolute / non-.md / outside root / symlink escape / missing
 *    clone / write error — each returns { ok: false } (AC-32).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Container } from '../../platform/container.js';
import type { Db } from '../../db/client.js';
import { ProjectContextService } from './service.js';
import { MAX_DISCOVERED_FILES } from './constants.js';

// ---------------------------------------------------------------------------
// Fixture: real tmpdir used when stat() / realpath() must succeed
// ---------------------------------------------------------------------------

let cloneRoot: string;

beforeAll(async () => {
  cloneRoot = await mkdtemp(join(tmpdir(), 'ctx-svc-test-'));
  // Create the minimal context directory structure
  await mkdir(join(cloneRoot, 'specs'), { recursive: true });
  await mkdir(join(cloneRoot, 'docs'), { recursive: true });
  await mkdir(join(cloneRoot, 'insights'), { recursive: true });
  // Legitimate files under context roots
  await writeFile(join(cloneRoot, 'specs', 'api.md'), '# API');
  await writeFile(join(cloneRoot, 'docs', 'guide.md'), '# Guide');
  await writeFile(join(cloneRoot, 'insights', 'notes.md'), '# Notes');
  // Non-context files (should be excluded)
  await writeFile(join(cloneRoot, 'README.md'), '# Readme');
  await mkdir(join(cloneRoot, 'src'), { recursive: true });
  await writeFile(join(cloneRoot, 'src', 'app.ts'), 'export {}');
  // Symlink that escapes the clone root (points to an absolute path outside cloneRoot).
  // Used by the save-document symlink-escape test (AC-32).
  await symlink('/etc/hosts', join(cloneRoot, 'docs', 'escape.md'));
});

afterAll(async () => {
  if (cloneRoot) await rm(cloneRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Mock builder helpers
// ---------------------------------------------------------------------------

type RepoRow = { owner: string; name: string };

/**
 * Build a minimal mock Container for `discoverDocuments` tests.
 *
 * db.select().from(repos).where(and(...))  →  returns repoResult
 */
function makeDiscoveryContainer(opts: {
  repoRow?: RepoRow | null;
  clonePath?: string;
  listDocsResult?: { path: string; sizeBytes: number }[];
  usedByCount?: number;
}): Container {
  const repoRow = opts.repoRow === undefined ? { owner: 'o', name: 'r' } : opts.repoRow;
  const repoResult: RepoRow[] = repoRow === null ? [] : [repoRow];

  // Supports both:
  //   await db.select().from().where()          — discoverDocuments
  //   await db.select().from().where().limit()  — previewDocument
  const limitFn = vi.fn().mockResolvedValue(repoResult);
  const whereResult = Object.assign(Promise.resolve(repoResult), { limit: limitFn });
  const whereFn = vi.fn().mockReturnValue(whereResult);
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  const db = { select: selectFn } as unknown as Db;

  const git = {
    clonePathFor: vi.fn().mockReturnValue(opts.clonePath ?? cloneRoot),
    listDocs: vi.fn().mockResolvedValue(opts.listDocsResult ?? []),
    readFile: vi.fn().mockResolvedValue('# content'),
  };

  const agentsRepo = {
    usedByAgentsCount: vi.fn().mockResolvedValue(opts.usedByCount ?? 0),
  };

  return { db, git, agentsRepo } as unknown as Container;
}

// ---------------------------------------------------------------------------
// discoverDocuments
// ---------------------------------------------------------------------------

describe('ProjectContextService – discoverDocuments', () => {
  it('returns empty state with reason when repo not found', async () => {
    const container = makeDiscoveryContainer({ repoRow: null });
    const service = new ProjectContextService(container);

    const result = await service.discoverDocuments('ws-1', 'repo-id-1');

    expect(result.documents).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.reason).toMatch(/repository not found/i);
  });

  it('returns empty state with reason when clone is missing (AC-3)', async () => {
    const container = makeDiscoveryContainer({
      // Non-existent path → stat() throws → degrade
      clonePath: '/no-such-clone-dir-xyz-98765',
    });
    const service = new ProjectContextService(container);

    const result = await service.discoverDocuments('ws-1', 'repo-id-1');

    expect(result.documents).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(result.reason).toBeTruthy();
    // Should mention cloning/sync pending (AC-3)
    expect(result.reason).toMatch(/clone|sync/i);
  });

  it('filters out .md files outside context root folders (AC-1)', async () => {
    // listDocs returns a mix: context + non-context .md files
    const listDocsResult = [
      { path: 'specs/api.md', sizeBytes: 100 },
      { path: 'docs/guide.md', sizeBytes: 200 },
      { path: 'insights/notes.md', sizeBytes: 150 },
      { path: 'README.md', sizeBytes: 50 },       // not under a context root
      { path: 'other/notes.md', sizeBytes: 80 },  // "other" is not a context root
    ];
    const container = makeDiscoveryContainer({ listDocsResult });
    const service = new ProjectContextService(container);

    const result = await service.discoverDocuments('ws-1', 'repo-id-1');

    const paths = result.documents.map((d) => d.path);
    expect(paths).toContain('specs/api.md');
    expect(paths).toContain('docs/guide.md');
    expect(paths).toContain('insights/notes.md');
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('other/notes.md');
    expect(result.documents).toHaveLength(3);
  });

  it('includes .md files where the context root appears at any depth (AC-1)', async () => {
    // packages/api/specs/foo.md — `specs` is at depth 2
    const listDocsResult = [
      { path: 'packages/api/specs/foo.md', sizeBytes: 120 },
      { path: 'src/app.md', sizeBytes: 50 },  // no context root at any depth → excluded
    ];
    const container = makeDiscoveryContainer({ listDocsResult });
    const service = new ProjectContextService(container);

    const result = await service.discoverDocuments('ws-1', 'repo-id-1');

    const paths = result.documents.map((d) => d.path);
    expect(paths).toContain('packages/api/specs/foo.md');
    expect(paths).not.toContain('src/app.md');
  });

  it('populates correct fields for each DiscoveredDocument (AC-1)', async () => {
    const listDocsResult = [{ path: 'specs/sub/api.md', sizeBytes: 400 }];
    const container = makeDiscoveryContainer({ listDocsResult, usedByCount: 2 });
    const service = new ProjectContextService(container);

    const result = await service.discoverDocuments('ws-1', 'repo-id-1');

    expect(result.documents).toHaveLength(1);
    const doc = result.documents[0]!;
    expect(doc.path).toBe('specs/sub/api.md');
    expect(doc.name).toBe('api.md');
    expect(doc.parent_path).toBe('specs/sub');
    expect(doc.folder_kind).toBe('specs');
    expect(doc.size_bytes).toBe(400);
    // est_tokens = ceil(400 / 4) = 100
    expect(doc.est_tokens).toBe(100);
    expect(doc.used_by_agents).toBe(2);
  });

  it('derives folder_kind from the nearest (deepest) matching ancestor segment', async () => {
    // packages/api/docs/guide.md — nearest root is `docs` (deepest match)
    const listDocsResult = [{ path: 'packages/api/docs/guide.md', sizeBytes: 200 }];
    const container = makeDiscoveryContainer({ listDocsResult });
    const service = new ProjectContextService(container);

    const result = await service.discoverDocuments('ws-1', 'repo-id-1');

    expect(result.documents).toHaveLength(1);
    const doc = result.documents[0]!;
    expect(doc.folder_kind).toBe('docs');
    expect(doc.parent_path).toBe('packages/api/docs');
    expect(doc.name).toBe('guide.md');
  });

  it('returns truncated:false when under the cap', async () => {
    // Exactly MAX_DISCOVERED_FILES entries under context roots
    const listDocsResult = Array.from({ length: MAX_DISCOVERED_FILES }, (_, i) => ({
      path: `specs/file-${i}.md`,
      sizeBytes: 100,
    }));
    const container = makeDiscoveryContainer({ listDocsResult });
    const service = new ProjectContextService(container);

    const result = await service.discoverDocuments('ws-1', 'repo-id-1');

    expect(result.truncated).toBe(false);
    expect(result.documents).toHaveLength(MAX_DISCOVERED_FILES);
  });

  it('returns exactly 500 documents + truncated:true when over the cap (AC-4)', async () => {
    // MAX + 1 entries — listDocs itself would cap, but service requests +1 to detect truncation
    const listDocsResult = Array.from({ length: MAX_DISCOVERED_FILES + 1 }, (_, i) => ({
      path: `specs/file-${i}.md`,
      sizeBytes: 100,
    }));
    const container = makeDiscoveryContainer({ listDocsResult });
    const service = new ProjectContextService(container);

    const result = await service.discoverDocuments('ws-1', 'repo-id-1');

    expect(result.truncated).toBe(true);
    expect(result.documents).toHaveLength(MAX_DISCOVERED_FILES);
  });

  it('returns truncated:false and no reason on a clean result', async () => {
    const listDocsResult = [{ path: 'docs/guide.md', sizeBytes: 80 }];
    const container = makeDiscoveryContainer({ listDocsResult });
    const service = new ProjectContextService(container);

    const result = await service.discoverDocuments('ws-1', 'repo-id-1');

    expect(result.truncated).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// previewDocument
// ---------------------------------------------------------------------------

describe('ProjectContextService – previewDocument', () => {
  /**
   * Build a container whose db.select chain supports the `.limit(1)` variant
   * used by previewDocument.
   */
  function makePreviewContainer(opts: {
    repoRow?: RepoRow | null;
    clonePath?: string;
    fileContent?: string;
    readFileThrows?: boolean;
  }): Container {
    const repoRow = opts.repoRow === undefined ? { owner: 'o', name: 'r' } : opts.repoRow;
    const repoResult: RepoRow[] = repoRow === null ? [] : [repoRow];

    // previewDocument without repoId uses .orderBy() (deterministic fallback).
    const orderByFn = vi.fn().mockResolvedValue(repoResult);
    const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    const selectFn = vi.fn().mockReturnValue({ from: fromFn });
    const db = { select: selectFn } as unknown as Db;

    const readFileMock = opts.readFileThrows
      ? vi.fn().mockRejectedValue(new Error('file not found'))
      : vi.fn().mockResolvedValue(opts.fileContent ?? '# content');

    const git = {
      clonePathFor: vi.fn().mockReturnValue(opts.clonePath ?? cloneRoot),
      readFile: readFileMock,
    };

    return { db, git } as unknown as Container;
  }

  it('returns { ok: false } when no repo is configured for the workspace', async () => {
    const container = makePreviewContainer({ repoRow: null });
    const service = new ProjectContextService(container);

    const result = await service.previewDocument('ws-1', 'specs/api.md');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/repository/i);
    }
  });

  it('returns { ok: false } for a path-traversal attempt (AC-8)', async () => {
    const container = makePreviewContainer({});
    const service = new ProjectContextService(container);

    const result = await service.previewDocument('ws-1', '../../etc/passwd');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // guardPath rejects lexically before realpath
      expect(result.reason).toMatch(/traversal/i);
    }
  });

  it('returns { ok: false } for an absolute path (AC-8)', async () => {
    const container = makePreviewContainer({});
    const service = new ProjectContextService(container);

    const result = await service.previewDocument('ws-1', '/etc/hosts');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/absolute/i);
    }
  });

  it('returns { ok: false } for a non-.md file (AC-8)', async () => {
    const container = makePreviewContainer({});
    const service = new ProjectContextService(container);

    const result = await service.previewDocument('ws-1', 'specs/schema.ts');

    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } for a .md file outside context root folders (AC-8)', async () => {
    const container = makePreviewContainer({});
    const service = new ProjectContextService(container);

    const result = await service.previewDocument('ws-1', 'src/notes.md');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/specs|docs|insights/i);
    }
  });

  it('returns { ok: true, document } with content for a confined path (AC-8)', async () => {
    const fileContent = '# API spec\n\nThis is the API.';
    const container = makePreviewContainer({ fileContent });
    const service = new ProjectContextService(container);

    // specs/api.md exists in the real cloneRoot (created in beforeAll)
    const result = await service.previewDocument('ws-1', 'specs/api.md');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.path).toBe('specs/api.md');
      expect(result.document.content).toBe(fileContent);
    }
  });

  it('returns { ok: false } when readFile throws (file unreadable)', async () => {
    const container = makePreviewContainer({ readFileThrows: true });
    const service = new ProjectContextService(container);

    const result = await service.previewDocument('ws-1', 'specs/api.md');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/read/i);
    }
  });
});

// ---------------------------------------------------------------------------
// saveDocument — AC-30, AC-31, AC-32
// ---------------------------------------------------------------------------

describe('ProjectContextService – saveDocument', () => {
  /**
   * Build a container whose db.select chain supports:
   *   await db.select().from().where()           — repoId provided
   *   await db.select().from().where().orderBy() — deterministic fallback
   *
   * git mock exposes `.writes` so tests can inspect what was written.
   */
  function makeSaveContainer(opts: {
    repoRow?: RepoRow | null;
    clonePath?: string;
    writeFileThrows?: boolean;
  }): Container {
    const repoRow = opts.repoRow === undefined ? { owner: 'o', name: 'r' } : opts.repoRow;
    const repoResult: RepoRow[] = repoRow === null ? [] : [repoRow];

    const orderByFn = vi.fn().mockResolvedValue(repoResult);
    // `.where()` must be directly awaitable (repoId path) AND expose `.orderBy()`.
    const whereResult = Object.assign(Promise.resolve(repoResult), { orderBy: orderByFn });
    const whereFn = vi.fn().mockReturnValue(whereResult);
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    const selectFn = vi.fn().mockReturnValue({ from: fromFn });
    const db = { select: selectFn } as unknown as Db;

    const writes = new Map<string, string>();
    const writeFileMock = opts.writeFileThrows
      ? vi.fn().mockRejectedValue(new Error('disk full'))
      : vi.fn().mockImplementation(async (_repo: unknown, path: string, content: string) => {
          writes.set(path, content);
        });

    const git = {
      clonePathFor: vi.fn().mockReturnValue(opts.clonePath ?? cloneRoot),
      writeFile: writeFileMock,
      // expose writes for assertions
      writes,
    };

    return { db, git } as unknown as Container;
  }

  it('writes content and echoes { path, content } for a confined path (AC-30, AC-31)', async () => {
    const container = makeSaveContainer({});
    const service = new ProjectContextService(container);
    const newContent = '# Updated API spec\n\nNew content.';

    // specs/api.md was created in beforeAll — guardPath realpath check passes.
    const result = await service.saveDocument('ws-1', 'specs/api.md', newContent);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.path).toBe('specs/api.md');
      expect(result.document.content).toBe(newContent);
    }
    // Verify writeFile was called with the right args (AC-31: adapter does the write).
    const git = container.git as unknown as { writes: Map<string, string> };
    expect(git.writes.get('specs/api.md')).toBe(newContent);
  });

  it('returns { ok: false } for a path-traversal attempt (AC-32)', async () => {
    const container = makeSaveContainer({});
    const service = new ProjectContextService(container);

    const result = await service.saveDocument('ws-1', '../../etc/passwd', 'evil');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/traversal/i);
    }
    // writeFile must NOT have been called.
    const git = container.git as unknown as { writes: Map<string, string> };
    expect(git.writes.size).toBe(0);
  });

  it('returns { ok: false } for an absolute path (AC-32)', async () => {
    const container = makeSaveContainer({});
    const service = new ProjectContextService(container);

    const result = await service.saveDocument('ws-1', '/etc/hosts', 'evil');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/absolute/i);
    }
    const git = container.git as unknown as { writes: Map<string, string> };
    expect(git.writes.size).toBe(0);
  });

  it('returns { ok: false } for a non-.md file (AC-32)', async () => {
    const container = makeSaveContainer({});
    const service = new ProjectContextService(container);

    // src/app.ts exists on disk but fails the .md check — write must not happen.
    const result = await service.saveDocument('ws-1', 'src/app.ts', 'evil');

    expect(result.ok).toBe(false);
    const git = container.git as unknown as { writes: Map<string, string> };
    expect(git.writes.size).toBe(0);
  });

  it('returns { ok: false } for a .md file outside context root folders (AC-32)', async () => {
    const container = makeSaveContainer({});
    const service = new ProjectContextService(container);

    // README.md is at clone root — no context-root ancestor segment.
    const result = await service.saveDocument('ws-1', 'README.md', 'evil');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/specs|docs|insights/i);
    }
    const git = container.git as unknown as { writes: Map<string, string> };
    expect(git.writes.size).toBe(0);
  });

  it('returns { ok: false } for a symlink that escapes the clone root (AC-32)', async () => {
    const container = makeSaveContainer({});
    const service = new ProjectContextService(container);

    // docs/escape.md was set up in beforeAll as a symlink to /etc/hosts.
    const result = await service.saveDocument('ws-1', 'docs/escape.md', 'evil');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/symlink|outside|escape/i);
    }
    const git = container.git as unknown as { writes: Map<string, string> };
    expect(git.writes.size).toBe(0);
  });

  it('returns { ok: false } when the clone is missing (AC-32)', async () => {
    const container = makeSaveContainer({ clonePath: '/no-such-clone-dir-save-xyz-98765' });
    const service = new ProjectContextService(container);

    const result = await service.saveDocument('ws-1', 'specs/api.md', 'content');

    expect(result.ok).toBe(false);
    // guardPath step 5: realpath on missing clone root fails.
    if (!result.ok) {
      expect(result.reason).toMatch(/clone|resolve/i);
    }
    const git = container.git as unknown as { writes: Map<string, string> };
    expect(git.writes.size).toBe(0);
  });

  it('returns { ok: false } when writeFile throws (unwritable, AC-32)', async () => {
    const container = makeSaveContainer({ writeFileThrows: true });
    const service = new ProjectContextService(container);

    // specs/api.md exists — guardPath passes, then writeFile throws.
    const result = await service.saveDocument('ws-1', 'specs/api.md', 'content');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/writ/i);
    }
  });

  it('returns { ok: false } when no repo is configured (AC-32)', async () => {
    const container = makeSaveContainer({ repoRow: null });
    const service = new ProjectContextService(container);

    const result = await service.saveDocument('ws-1', 'specs/api.md', 'content');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/repository/i);
    }
  });
});
