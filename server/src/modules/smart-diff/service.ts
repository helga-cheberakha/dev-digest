import { desc, eq } from 'drizzle-orm';
import type { SmartDiff, SmartDiffFile, SmartDiffRole } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { classifyFile } from './classifier.js';
import { TOO_BIG_THRESHOLD } from './constants.js';

/**
 * Build a SmartDiff DTO from persisted PR files + the latest review's findings.
 * No LLM call — purely deterministic path-pattern classification + DB reads.
 */
export async function buildSmartDiff(db: Db, prId: string): Promise<SmartDiff> {
  const files = await db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));

  // Findings from the single most-recent review (best-effort; empty if none yet)
  const [latestReview] = await db
    .select({ id: t.reviews.id })
    .from(t.reviews)
    .where(eq(t.reviews.prId, prId))
    .orderBy(desc(t.reviews.createdAt))
    .limit(1);

  const findingLinesByFile = new Map<string, number[]>();
  if (latestReview) {
    const rows = await db
      .select({ file: t.findings.file, startLine: t.findings.startLine })
      .from(t.findings)
      .where(eq(t.findings.reviewId, latestReview.id));
    for (const row of rows) {
      let lines = findingLinesByFile.get(row.file);
      if (!lines) {
        lines = [];
        findingLinesByFile.set(row.file, lines);
      }
      lines.push(row.startLine);
    }
  }

  const grouped = new Map<SmartDiffRole, SmartDiffFile[]>();
  for (const file of files) {
    const role = classifyFile(file.path);
    const dto: SmartDiffFile = {
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLinesByFile.get(file.path) ?? [],
    };
    let arr = grouped.get(role);
    if (!arr) {
      arr = [];
      grouped.set(role, arr);
    }
    arr.push(dto);
  }

  // Within each group, sort by finding count descending so the riskiest files surface first
  for (const arr of grouped.values()) {
    arr.sort((a, b) => b.finding_lines.length - a.finding_lines.length);
  }

  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];
  return {
    groups: ROLE_ORDER.filter((r) => grouped.has(r)).map((r) => ({
      role: r,
      files: grouped.get(r)!,
    })),
    split_suggestion: {
      too_big: totalLines > TOO_BIG_THRESHOLD,
      total_lines: totalLines,
      proposed_splits: [],
    },
  };
}
