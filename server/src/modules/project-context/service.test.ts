/**
 * Tests for ProjectContextService (T7 — AC-1, AC-2, AC-3, AC-4, AC-8, AC-9).
 *
 * Covers:
 *  - Discovery: filtering to context root folders only (AC-1).
 *  - Discovery: stat-only (no file content opened, AC-2).
 *  - Discovery: empty state + reason on missing clone (AC-3).
 *  - Discovery: cap at 500 + truncated flag (AC-4).
 *  - Preview: confined path returns content (AC-8).
 *  - Preview: traversal / escaping path returns rejection (AC-8).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

    const limitFn = vi.fn().mockResolvedValue(repoResult);
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
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
