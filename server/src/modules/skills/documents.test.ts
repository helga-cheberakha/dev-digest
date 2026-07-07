/**
 * T6 — Skill document-attachment tests.
 *
 * Covers:
 *  - SkillsRepository: documentsForSkill / setDocuments round-trip (order preserved)
 *  - SkillsService: bad-path rejection (guard fail → ValidationError, nothing persisted)
 *  - SkillsService: valid paths accepted, persisted, returned in order
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from '../../db/client.js';
import { SkillsRepository } from './repository.js';
import { SkillsService } from './service.js';
import type { Container } from '../../platform/container.js';
import { ValidationError } from '../../platform/errors.js';

// ---------------------------------------------------------------------------
// Mock the path-guard module — allows service tests without real filesystem
// ---------------------------------------------------------------------------

vi.mock('../project-context/path-guard.js', () => ({
  guardPath: vi.fn(),
}));

// Import after mock registration so we get the mocked version.
// `import type` is NOT used here — we need the runtime mock reference.
import { guardPath } from '../project-context/path-guard.js';
const mockGuardPath = vi.mocked(guardPath);

// ---------------------------------------------------------------------------
// SkillsRepository — document methods
// ---------------------------------------------------------------------------

describe('SkillsRepository.documentsForSkill', () => {
  it('returns paths in ascending order', async () => {
    const orderByFn = vi.fn().mockResolvedValue([
      { path: 'specs/a.md' },
      { path: 'docs/b.md' },
    ]);
    const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    const selectFn = vi.fn().mockReturnValue({ from: fromFn });

    const db = { select: selectFn } as unknown as Db;
    const repo = new SkillsRepository(db);

    const result = await repo.documentsForSkill('skill-1');

    expect(result).toEqual(['specs/a.md', 'docs/b.md']);
    expect(selectFn).toHaveBeenCalled();
  });

  it('returns [] when no documents are attached', async () => {
    const orderByFn = vi.fn().mockResolvedValue([]);
    const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    const selectFn = vi.fn().mockReturnValue({ from: fromFn });

    const db = { select: selectFn } as unknown as Db;
    const repo = new SkillsRepository(db);

    const result = await repo.documentsForSkill('skill-1');

    expect(result).toEqual([]);
  });
});

describe('SkillsRepository.setDocuments', () => {
  it('deletes existing rows and inserts new paths with correct order index', async () => {
    const deleteWhereFn = vi.fn().mockResolvedValue([]);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhereFn });

    const insertValuesFn = vi.fn().mockResolvedValue([]);
    const insertFn = vi.fn().mockReturnValue({ values: insertValuesFn });

    const db = { delete: deleteFn, insert: insertFn } as unknown as Db;
    const repo = new SkillsRepository(db);

    await repo.setDocuments('skill-1', ['specs/a.md', 'docs/b.md']);

    expect(deleteFn).toHaveBeenCalled();
    expect(deleteWhereFn).toHaveBeenCalled();
    expect(insertFn).toHaveBeenCalled();
    expect(insertValuesFn).toHaveBeenCalledWith([
      { skillId: 'skill-1', path: 'specs/a.md', order: 0 },
      { skillId: 'skill-1', path: 'docs/b.md', order: 1 },
    ]);
  });

  it('only deletes (no insert) when paths array is empty', async () => {
    const deleteWhereFn = vi.fn().mockResolvedValue([]);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhereFn });
    const insertFn = vi.fn();

    const db = { delete: deleteFn, insert: insertFn } as unknown as Db;
    const repo = new SkillsRepository(db);

    await repo.setDocuments('skill-1', []);

    expect(deleteFn).toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SkillsService — document methods (guardPath is mocked)
// ---------------------------------------------------------------------------

interface MockRepo {
  getById: ReturnType<typeof vi.fn>;
  documentsForSkill: ReturnType<typeof vi.fn>;
  setDocuments: ReturnType<typeof vi.fn>;
}

function makeService(): { service: SkillsService; mockRepo: MockRepo } {
  const mockRepo: MockRepo = {
    getById: vi.fn(),
    documentsForSkill: vi.fn(),
    setDocuments: vi.fn(),
  };

  // Container only needs `skillsRepo` for the methods under test.
  const mockContainer = {
    skillsRepo: mockRepo,
  } as unknown as Container;

  const service = new SkillsService(mockContainer);
  return { service, mockRepo };
}

describe('SkillsService.getDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when skill is not found', async () => {
    const { service, mockRepo } = makeService();
    mockRepo.getById.mockResolvedValue(undefined);

    const result = await service.getDocuments('ws-1', 'skill-99');

    expect(result).toBeUndefined();
  });

  it('returns the ordered document paths for an existing skill', async () => {
    const { service, mockRepo } = makeService();
    mockRepo.getById.mockResolvedValue({ id: 'skill-1', workspaceId: 'ws-1' });
    mockRepo.documentsForSkill.mockResolvedValue(['specs/guide.md', 'docs/api.md']);

    const result = await service.getDocuments('ws-1', 'skill-1');

    expect(result).toEqual(['specs/guide.md', 'docs/api.md']);
    expect(mockRepo.documentsForSkill).toHaveBeenCalledWith('skill-1');
  });
});

describe('SkillsService.setDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when skill is not found', async () => {
    const { service, mockRepo } = makeService();
    mockRepo.getById.mockResolvedValue(undefined);

    const result = await service.setDocuments('ws-1', 'skill-99', ['specs/a.md'], '/clone');

    expect(result).toBeUndefined();
    expect(mockRepo.setDocuments).not.toHaveBeenCalled();
  });

  it('rejects a path containing ".." (traversal) and persists nothing', async () => {
    const { service, mockRepo } = makeService();
    mockRepo.getById.mockResolvedValue({ id: 'skill-1' });
    mockGuardPath.mockResolvedValue({ ok: false, reason: 'path traversal via ".." is not allowed' });

    await expect(
      service.setDocuments('ws-1', 'skill-1', ['../../etc/passwd'], '/clone'),
    ).rejects.toThrow(ValidationError);

    expect(mockRepo.setDocuments).not.toHaveBeenCalled();
  });

  it('rejects an absolute path and persists nothing', async () => {
    const { service, mockRepo } = makeService();
    mockRepo.getById.mockResolvedValue({ id: 'skill-1' });
    mockGuardPath.mockResolvedValue({ ok: false, reason: 'absolute paths are not allowed' });

    await expect(
      service.setDocuments('ws-1', 'skill-1', ['/etc/hosts'], '/clone'),
    ).rejects.toThrow(ValidationError);

    expect(mockRepo.setDocuments).not.toHaveBeenCalled();
  });

  it('rejects a non-.md path (e.g. src/app.ts) and persists nothing', async () => {
    const { service, mockRepo } = makeService();
    mockRepo.getById.mockResolvedValue({ id: 'skill-1' });
    mockGuardPath.mockResolvedValue({ ok: false, reason: 'only .md files are allowed' });

    await expect(
      service.setDocuments('ws-1', 'skill-1', ['src/app.ts'], '/clone'),
    ).rejects.toThrow(ValidationError);

    expect(mockRepo.setDocuments).not.toHaveBeenCalled();
  });

  it('persists valid paths in order and returns them (round-trip)', async () => {
    const { service, mockRepo } = makeService();
    mockRepo.getById.mockResolvedValue({ id: 'skill-1' });
    mockGuardPath
      .mockResolvedValueOnce({ ok: true, path: 'specs/guide.md' })
      .mockResolvedValueOnce({ ok: true, path: 'docs/api.md' });
    mockRepo.setDocuments.mockResolvedValue(undefined);
    mockRepo.documentsForSkill.mockResolvedValue(['specs/guide.md', 'docs/api.md']);

    const result = await service.setDocuments(
      'ws-1',
      'skill-1',
      ['specs/guide.md', 'docs/api.md'],
      '/clone/root',
    );

    expect(result).toEqual(['specs/guide.md', 'docs/api.md']);
    // Verify persistence was called with validated paths in order
    expect(mockRepo.setDocuments).toHaveBeenCalledWith('skill-1', [
      'specs/guide.md',
      'docs/api.md',
    ]);
    // Guard was called once per path
    expect(mockGuardPath).toHaveBeenCalledTimes(2);
    expect(mockGuardPath).toHaveBeenNthCalledWith(1, 'specs/guide.md', '/clone/root');
    expect(mockGuardPath).toHaveBeenNthCalledWith(2, 'docs/api.md', '/clone/root');
  });

  it('stops at the first bad path and does not call setDocuments', async () => {
    const { service, mockRepo } = makeService();
    mockRepo.getById.mockResolvedValue({ id: 'skill-1' });
    // First path good, second path bad
    mockGuardPath
      .mockResolvedValueOnce({ ok: true, path: 'specs/good.md' })
      .mockResolvedValueOnce({ ok: false, reason: 'only .md files are allowed' });

    await expect(
      service.setDocuments('ws-1', 'skill-1', ['specs/good.md', 'src/app.ts'], '/clone'),
    ).rejects.toThrow(ValidationError);

    expect(mockRepo.setDocuments).not.toHaveBeenCalled();
  });

  it('accepts an empty paths array and clears all documents', async () => {
    const { service, mockRepo } = makeService();
    mockRepo.getById.mockResolvedValue({ id: 'skill-1' });
    mockRepo.setDocuments.mockResolvedValue(undefined);
    mockRepo.documentsForSkill.mockResolvedValue([]);

    const result = await service.setDocuments('ws-1', 'skill-1', [], '/clone');

    expect(result).toEqual([]);
    expect(mockRepo.setDocuments).toHaveBeenCalledWith('skill-1', []);
    // Guard was never called (no paths to validate)
    expect(mockGuardPath).not.toHaveBeenCalled();
  });
});
