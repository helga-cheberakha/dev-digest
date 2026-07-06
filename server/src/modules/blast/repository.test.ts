import { describe, it, expect, vi } from 'vitest';
import type { Db } from '../../db/client.js';
import { BlastRepository } from './repository.js';

describe('BlastRepository', () => {
  it('findPriorPrsTouchingSameFiles returns [] when paths is empty', async () => {
    // Construct a db stub — selectDistinct must never be called for empty paths
    const db = { selectDistinct: vi.fn() } as unknown as Db;

    const repo = new BlastRepository(db);
    const result = await repo.findPriorPrsTouchingSameFiles('ws-1', 'repo-1', 'pr-1', [], 5);

    expect(result).toEqual([]);
    expect(db.selectDistinct).not.toHaveBeenCalled();
  });

  it('findPriorPrsTouchingSameFiles returns prior PRs when paths are non-empty', async () => {
    const fixtureRow = {
      id: 'pr-2',
      number: 99,
      title: 'Old fix',
      openedAt: new Date('2026-01-01'),
      status: 'merged',
    };

    // Build chain from terminal back: limit → orderBy → where → innerJoin → from → selectDistinct
    const limitFn = vi.fn().mockResolvedValue([fixtureRow]);
    const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
    const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
    const innerJoinFn = vi.fn().mockReturnValue({ where: whereFn });
    const fromFn = vi.fn().mockReturnValue({ innerJoin: innerJoinFn });
    const selectDistinctFn = vi.fn().mockReturnValue({ from: fromFn });

    const db = { selectDistinct: selectDistinctFn } as unknown as Db;

    const repo = new BlastRepository(db);
    const result = await repo.findPriorPrsTouchingSameFiles('ws-1', 'repo-1', 'pr-1', ['src/foo.ts'], 5);

    expect(result).toEqual([fixtureRow]);
    expect(db.selectDistinct).toHaveBeenCalled();
  });

  it('getChangedFiles returns array of file paths', async () => {
    // Chain: select().from().where() — where() is awaited by the repository
    const whereFn = vi.fn().mockResolvedValue([{ path: 'src/foo.ts' }]);
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    const selectFn = vi.fn().mockReturnValue({ from: fromFn });

    const db = { select: selectFn } as unknown as Db;

    const repo = new BlastRepository(db);
    const result = await repo.getChangedFiles('pr-1');

    expect(result).toEqual(['src/foo.ts']);
  });

  it('findPrByWorkspace returns the projected PR when found', async () => {
    // Chain: select().from().where() — where() is awaited; only id + repoId are projected
    const whereFn = vi.fn().mockResolvedValue([{ id: 'pr-1', repoId: 'repo-1' }]);
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    const selectFn = vi.fn().mockReturnValue({ from: fromFn });

    const db = { select: selectFn } as unknown as Db;

    const repo = new BlastRepository(db);
    const result = await repo.findPrByWorkspace('ws-1', 'pr-1');

    expect(result).toEqual({ id: 'pr-1', repoId: 'repo-1' });
  });

  it('findPrByWorkspace returns undefined when PR is not found', async () => {
    const whereFn = vi.fn().mockResolvedValue([]);
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    const selectFn = vi.fn().mockReturnValue({ from: fromFn });

    const db = { select: selectFn } as unknown as Db;

    const repo = new BlastRepository(db);
    const result = await repo.findPrByWorkspace('ws-1', 'pr-999');

    expect(result).toBeUndefined();
  });
});
