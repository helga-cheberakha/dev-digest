import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Infrastructure layer — blast-radius data access.
 * Owns queries over `pull_requests` × `pr_files`.
 */
export class BlastRepository {
  constructor(private readonly db: Db) {}

  /**
   * Looks up a PR by workspace + PR id.
   * Returns `{ id, repoId }` or `undefined` if not found.
   */
  async findPrByWorkspace(
    workspaceId: string,
    prId: string,
  ): Promise<{ id: string; repoId: string } | undefined> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id, repoId: t.pullRequests.repoId })
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.id, prId),
        ),
      );
    return row;
  }

  /**
   * Returns the list of file paths changed in a PR.
   */
  async getChangedFiles(prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    return rows.map((r) => r.path);
  }

  /**
   * Returns up to `limit` distinct prior PRs (excluding `excludePrId`) that
   * touch at least one of the given `paths`, ordered newest first.
   *
   * Returns `[]` immediately when `paths` is empty — no DB call.
   * Paths are capped at `maxPaths` before the `inArray` query to avoid
   * unbounded query parameters on large PRs.
   */
  async findPriorPrsTouchingSameFiles(
    workspaceId: string,
    repoId: string,
    excludePrId: string,
    paths: string[],
    limit = 5,
    maxPaths = 50,
  ) {
    if (paths.length === 0) return [];

    const safePaths = paths.slice(0, maxPaths);

    return this.db
      .selectDistinct({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        openedAt: t.pullRequests.openedAt,
        status: t.pullRequests.status,
      })
      .from(t.pullRequests)
      .innerJoin(t.prFiles, eq(t.pullRequests.id, t.prFiles.prId))
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          ne(t.pullRequests.id, excludePrId),
          inArray(t.prFiles.path, safePaths),
        ),
      )
      .orderBy(desc(t.pullRequests.openedAt))
      .limit(limit);
  }
}
