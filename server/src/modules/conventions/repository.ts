import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Convention } from '@devdigest/shared';

export type ConventionRow = typeof t.conventions.$inferSelect;

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  category: string;
  rule: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  confidence: number;
}

export interface UpdateConvention {
  status?: 'pending' | 'accepted' | 'rejected';
  rule?: string;
  snippet?: string;
}

export function toConventionDto(row: ConventionRow): Convention {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    repo_id: row.repoId ?? '',
    category: row.category,
    rule: row.rule,
    file_path: row.evidencePath ?? '',
    line_start: row.lineStart,
    line_end: row.lineEnd,
    snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    status: (row.status ?? 'pending') as Convention['status'],
    created_at: row.createdAt.toISOString(),
  };
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  /** All non-rejected conventions for a repo, accepted first then by confidence. */
  async listForRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          ne(t.conventions.status, 'rejected'),
        ),
      )
      // 'accepted' < 'pending' alphabetically, so asc puts accepted first
      .orderBy(asc(t.conventions.status), desc(t.conventions.confidence));
  }

  /** Insert a batch of new convention candidates (all status='pending'). */
  async insertBatch(values: InsertConvention[]): Promise<ConventionRow[]> {
    if (values.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        values.map((v) => ({
          workspaceId: v.workspaceId,
          repoId: v.repoId,
          category: v.category,
          rule: v.rule,
          evidencePath: v.filePath,
          lineStart: v.lineStart,
          lineEnd: v.lineEnd,
          evidenceSnippet: v.snippet,
          confidence: v.confidence,
          status: 'pending' as const,
        })),
      )
      .returning();
  }

  /** Update a single convention (status, rule, or snippet). Workspace-scoped. */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.snippet !== undefined ? { evidenceSnippet: patch.snippet } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Accepted conventions only, used for skill generation. */
  async listAccepted(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'accepted'),
        ),
      )
      .orderBy(desc(t.conventions.confidence));
  }

  /**
   * Delete all pending + rejected conventions for a repo before a re-extract.
   * Accepted conventions are preserved so the user doesn't lose approvals.
   */
  async deleteStale(repoId: string): Promise<void> {
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.status, ['pending', 'rejected']),
        ),
      );
  }

  /** Atomically replace all pending/rejected conventions with a new batch. Accepted are preserved. */
  async replaceAll(repoId: string, values: InsertConvention[]): Promise<ConventionRow[]> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.conventions)
        .where(
          and(
            eq(t.conventions.repoId, repoId),
            inArray(t.conventions.status, ['pending', 'rejected']),
          ),
        );
      if (values.length === 0) return [];
      return tx
        .insert(t.conventions)
        .values(
          values.map((v) => ({
            workspaceId: v.workspaceId,
            repoId: v.repoId,
            category: v.category,
            rule: v.rule,
            evidencePath: v.filePath,
            lineStart: v.lineStart,
            lineEnd: v.lineEnd,
            evidenceSnippet: v.snippet,
            confidence: v.confidence,
            status: 'pending' as const,
          })),
        )
        .returning();
    });
  }
}
