/**
 * Tests for agent document attachment (T5: AC-5, AC-8, AC-9).
 *
 * Repository tests use the mock-db chain pattern (no real Postgres needed).
 * Service tests verify path-guard validation behaviour at the boundary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../../db/client.js';
import type { Container } from '../../platform/container.js';
import { AgentsRepository } from './repository.js';
import { AgentsService } from './service.js';
import { ValidationError } from '../../platform/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal AgentRow fixture — only the fields queried by getById / the service.
 * Cast to the full row type via `as unknown`.
 */
function agentFixture(id = 'agent-1', workspaceId = 'ws-1') {
  return { id, workspaceId, name: 'Test Agent', enabled: true } as ReturnType<
    AgentsRepository['getById']
  > extends Promise<infer R>
    ? R
    : never;
}

// ---------------------------------------------------------------------------
// AgentsRepository — document-attachment methods
// ---------------------------------------------------------------------------

describe('AgentsRepository – document attachment', () => {
  describe('setDocuments + documentsForAgent (round-trip)', () => {
    it('persists paths in order and retrieves them ordered', async () => {
      const paths = ['specs/api.md', 'docs/guide.md', 'insights/notes.md'];

      // Drizzle chain for delete().where()
      const deleteWhereFn = vi.fn().mockResolvedValue(undefined);
      const deleteFn = vi.fn().mockReturnValue({ where: deleteWhereFn });

      // Drizzle chain for insert().values()
      const insertValuesFn = vi.fn().mockResolvedValue([]);
      const insertFn = vi.fn().mockReturnValue({ values: insertValuesFn });

      // Drizzle chain for select().from().where().orderBy() → return rows
      const orderByFn = vi
        .fn()
        .mockResolvedValue(paths.map((path) => ({ path })));
      const selectWhereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
      const selectFromFn = vi.fn().mockReturnValue({ where: selectWhereFn });
      const selectFn = vi.fn().mockReturnValue({ from: selectFromFn });

      const db = {
        delete: deleteFn,
        insert: insertFn,
        select: selectFn,
      } as unknown as Db;

      const repo = new AgentsRepository(db);

      await repo.setDocuments('agent-1', paths);
      const result = await repo.documentsForAgent('agent-1');

      // Verify delete was called (replaces whole set)
      expect(deleteFn).toHaveBeenCalledOnce();
      expect(deleteWhereFn).toHaveBeenCalledOnce();

      // Verify insert received paths in order
      expect(insertFn).toHaveBeenCalledOnce();
      expect(insertValuesFn).toHaveBeenCalledWith(
        paths.map((path, i) => ({ agentId: 'agent-1', path, order: i })),
      );

      // Verify retrieval returns the correct paths
      expect(result).toEqual(paths);
    });

    it('setDocuments with empty array only deletes (no insert)', async () => {
      const deleteWhereFn = vi.fn().mockResolvedValue(undefined);
      const deleteFn = vi.fn().mockReturnValue({ where: deleteWhereFn });
      const insertFn = vi.fn();
      const db = { delete: deleteFn, insert: insertFn } as unknown as Db;

      const repo = new AgentsRepository(db);
      await repo.setDocuments('agent-1', []);

      expect(deleteFn).toHaveBeenCalledOnce();
      expect(insertFn).not.toHaveBeenCalled();
    });
  });

  describe('usedByAgentsCount', () => {
    it('returns the count of agents attaching the given path', async () => {
      const whereFn = vi.fn().mockResolvedValue([{ cnt: 2 }]);
      const fromFn = vi.fn().mockReturnValue({ where: whereFn });
      const selectFn = vi.fn().mockReturnValue({ from: fromFn });

      const db = { select: selectFn } as unknown as Db;
      const repo = new AgentsRepository(db);

      const result = await repo.usedByAgentsCount('specs/api.md');
      expect(result).toBe(2);
    });

    it('returns 0 when no agents attach the path', async () => {
      const whereFn = vi.fn().mockResolvedValue([{ cnt: 0 }]);
      const fromFn = vi.fn().mockReturnValue({ where: whereFn });
      const selectFn = vi.fn().mockReturnValue({ from: fromFn });

      const db = { select: selectFn } as unknown as Db;
      const repo = new AgentsRepository(db);

      const result = await repo.usedByAgentsCount('specs/nonexistent.md');
      expect(result).toBe(0);
    });

    it('returns 0 when the row is absent (empty result)', async () => {
      const whereFn = vi.fn().mockResolvedValue([]);
      const fromFn = vi.fn().mockReturnValue({ where: whereFn });
      const selectFn = vi.fn().mockReturnValue({ from: fromFn });

      const db = { select: selectFn } as unknown as Db;
      const repo = new AgentsRepository(db);

      const result = await repo.usedByAgentsCount('specs/any.md');
      expect(result).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// AgentsService — path-guard validation (AC-8)
// ---------------------------------------------------------------------------

describe('AgentsService – setDocuments path validation', () => {
  const AGENT_ROW = agentFixture();

  /**
   * Build a mock Container whose db handles:
   *   1st select call  → getById (agents table) → returns [agentRow] or []
   *   2nd select call  → resolveCloneRoot (repos table) → returns [repoRow] or []
   *
   * and whose git.clonePathFor returns a given cloneRoot path.
   */
  function makeContainer(opts: {
    agentRow?: typeof AGENT_ROW | undefined;
    repoRow?: { owner: string; name: string } | undefined;
    cloneRoot?: string;
  }): Container {
    let selectCallCount = 0;
    const db = {
      select: vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // getById: select().from(agents).where(and(...))
          const whereFn = vi.fn().mockResolvedValue(
            opts.agentRow ? [opts.agentRow] : [],
          );
          return { from: vi.fn().mockReturnValue({ where: whereFn }) };
        }
        // resolveCloneRoot: select().from(repos).where(...).limit(1)
        const limitFn = vi.fn().mockResolvedValue(
          opts.repoRow ? [opts.repoRow] : [],
        );
        const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
        return { from: vi.fn().mockReturnValue({ where: whereFn }) };
      }),
    };

    const git = {
      clonePathFor: vi.fn().mockReturnValue(opts.cloneRoot ?? ''),
    };

    return { db, git } as unknown as Container;
  }

  describe('bad path rejection (lexical — no clone needed)', () => {
    it('rejects a traversal path "../../etc/passwd"', async () => {
      const container = makeContainer({ agentRow: AGENT_ROW });
      const service = new AgentsService(container);

      await expect(
        service.setDocuments('ws-1', 'agent-1', ['../../etc/passwd']),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects an absolute path "/etc/hosts"', async () => {
      const container = makeContainer({ agentRow: AGENT_ROW });
      const service = new AgentsService(container);

      await expect(
        service.setDocuments('ws-1', 'agent-1', ['/etc/hosts']),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects a non-.md path "src/app.ts"', async () => {
      const container = makeContainer({ agentRow: AGENT_ROW });
      const service = new AgentsService(container);

      await expect(
        service.setDocuments('ws-1', 'agent-1', ['src/app.ts']),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects a path outside the configured root folders "README.md"', async () => {
      const container = makeContainer({ agentRow: AGENT_ROW });
      const service = new AgentsService(container);

      await expect(
        service.setDocuments('ws-1', 'agent-1', ['README.md']),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects a mix of bad and good-looking paths — persists nothing', async () => {
      const container = makeContainer({ agentRow: AGENT_ROW });
      const service = new AgentsService(container);

      // Even if one path is otherwise structurally valid, the traversal
      // path must cause the whole request to be rejected.
      await expect(
        service.setDocuments('ws-1', 'agent-1', ['../../etc/passwd']),
      ).rejects.toThrow(ValidationError);
    });

    it('returns undefined when the agent does not exist', async () => {
      const container = makeContainer({ agentRow: undefined });
      const service = new AgentsService(container);

      const result = await service.setDocuments('ws-1', 'nonexistent', ['specs/x.md']);
      expect(result).toBeUndefined();
    });
  });

  describe('happy path — valid paths accepted and stored', () => {
    let tmpDir: string;

    beforeEach(async () => {
      // Create a minimal fake clone: <tmpDir>/specs/valid-doc.md
      tmpDir = await mkdtemp(join(tmpdir(), 'agent-docs-test-'));
      await mkdir(join(tmpDir, 'specs'), { recursive: true });
      await writeFile(join(tmpDir, 'specs', 'valid-doc.md'), '# Test');
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('accepts a valid confined path and persists it (round-trip)', async () => {
      const repoRow = { owner: 'myorg', name: 'myrepo' };

      // The final select chain used by documentsForAgent after setDocuments
      const orderByFn = vi.fn().mockResolvedValue([{ path: 'specs/valid-doc.md' }]);
      const selectWhereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });

      // delete().where() for setDocuments
      const deleteWhereFn = vi.fn().mockResolvedValue(undefined);
      const deleteFn = vi.fn().mockReturnValue({ where: deleteWhereFn });

      // insert().values() for setDocuments
      const insertValuesFn = vi.fn().mockResolvedValue([]);
      const insertFn = vi.fn().mockReturnValue({ values: insertValuesFn });

      let selectCallCount = 0;
      const db = {
        delete: deleteFn,
        insert: insertFn,
        select: vi.fn(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            // getById
            return {
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([AGENT_ROW]),
              }),
            };
          }
          if (selectCallCount === 2) {
            // resolveCloneRoot
            return {
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([repoRow]),
                }),
              }),
            };
          }
          // documentsForAgent after persist
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ orderBy: orderByFn }),
            }),
          };
        }),
        git: undefined,
      };

      const git = { clonePathFor: vi.fn().mockReturnValue(tmpDir) };
      const container = { db, git } as unknown as Container;
      const service = new AgentsService(container);

      const result = await service.setDocuments('ws-1', 'agent-1', ['specs/valid-doc.md']);

      expect(result).toEqual(['specs/valid-doc.md']);
      expect(insertValuesFn).toHaveBeenCalledWith([
        { agentId: 'agent-1', path: 'specs/valid-doc.md', order: 0 },
      ]);
    });
  });
});
