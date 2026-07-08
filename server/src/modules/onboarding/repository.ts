import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { OnboardingArtifact } from '@devdigest/shared';
import { OnboardingArtifact as OnboardingArtifactSchema } from '@devdigest/shared';

/**
 * OnboardingRepository — infrastructure layer; the ONLY file allowed to touch
 * the `onboarding` table.
 *
 * ─── TENANCY CONTRACT ────────────────────────────────────────────────────────
 * The `onboarding` table has NO `workspace_id` column. Every caller MUST verify
 * workspace ownership via `RepoRepository.getById(workspaceId, repoId)` (which
 * filters `repos.workspace_id`) BEFORE invoking `read` or `upsert`. This
 * repository is keyed by `repoId` only and performs no tenancy check itself.
 *
 * ─── LEGACY ROW CONTRACT ─────────────────────────────────────────────────────
 * A row written before the `head_sha` column existed has `headSha === null`.
 * `read` surfaces such a row as-is (headSha: null). The service MUST treat a
 * null `headSha` as a cache miss → regenerate. This is never a corrupt read.
 *
 * ─── CACHE-HIT LOGIC ─────────────────────────────────────────────────────────
 * Cache-hit determination (`stored.headSha === currentHead`) is the service's
 * responsibility. This repository is pure persistence: read and upsert.
 */
export class OnboardingRepository {
  constructor(private readonly db: Db) {}

  /**
   * Returns the stored artifact and its headSha for the given repo, or `null`
   * if no row exists yet.
   *
   * A returned value with `headSha === null` is a legacy row (written before
   * the `head_sha` column was added). The service must treat it as a cache miss.
   *
   * @throws {ZodError} if the stored JSON fails to parse against OnboardingArtifact
   *   — this indicates data corruption and should not be silently swallowed.
   */
  async read(
    repoId: string,
  ): Promise<{ artifact: OnboardingArtifact; headSha: string | null } | null> {
    const [row] = await this.db
      .select()
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));

    if (!row) return null;

    return {
      artifact: OnboardingArtifactSchema.parse(row.json),
      headSha: row.headSha,
    };
  }

  /**
   * Writes (or overwrites) the single onboarding row for this repo.
   *
   * The artifact MUST have already been validated with `OnboardingArtifact.parse()`
   * by the service before this is called — upsert is the success path only.
   * On LLM failure the service returns the skeleton and leaves any prior cache
   * row intact (i.e. never calls upsert on the failure path).
   */
  async upsert(
    repoId: string,
    artifact: OnboardingArtifact,
    headSha: string,
  ): Promise<void> {
    await this.db
      .insert(t.onboarding)
      .values({
        repoId,
        json: artifact as unknown,
        headSha,
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [t.onboarding.repoId],
        set: {
          json: artifact as unknown,
          headSha,
          generatedAt: new Date(),
        },
      });
  }
}
