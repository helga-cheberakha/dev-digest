/**
 * modules/brief/service.ts — Why+Risk Brief orchestrator (AC-1, AC-2, AC-3,
 * AC-6, AC-7, AC-8, AC-9, AC-17).
 *
 * Cache-first, advisory-locked generation:
 *  1. Unlocked fast path (M3, true double-check) — a cache hit on the
 *     current `head_sha` returns immediately with ZERO LLM calls and without
 *     opening a transaction, so an ordinary page-load POST never queues
 *     behind an in-flight generation for the same PR.
 *  2. On a miss (or `force`), gather facts (intent, blast radius, smart
 *     diff, linked issue, Context-Folder specs) and resolve the feature
 *     model — ALL of this happens BEFORE the advisory lock is taken. None of
 *     it needs the lock or makes an LLM call, and fact gathering in
 *     particular (blast/smart-diff/GitHub/doc reads) is the slow part
 *     (network + DB reads across other modules); doing it outside the lock
 *     keeps the pooled transaction connection from being pinned for that
 *     duration (HIGH-2 architecture-review fix — with a small pool,
 *     concurrent cache misses across different PRs would otherwise starve
 *     every other route for up to the full LLM timeout). Tradeoff: a
 *     genuine waiter (a second request that arrives while another is
 *     generating) gathers facts needlessly once before discovering the
 *     winner's cache hit inside the lock — acceptable, since it's cheap
 *     relative to an LLM call and never happens more than once per waiter.
 *  3. Take the PR-scoped advisory lock (`BriefRepository.withPrLock`) and
 *     re-read the cache INSIDE the lock — a genuine waiter sees the
 *     winner's just-committed row and also makes ZERO LLM calls (AC-17).
 *     Only what genuinely needs the lock/transaction lives inside it: the
 *     in-lock cache re-read, the single bounded LLM call, grounding,
 *     `Brief.parse()`, the head_sha read used for the upsert, and the
 *     upsert itself.
 *  4. Make exactly ONE structured LLM call, bounded by `BRIEF_LLM_TIMEOUT_MS`
 *     so a hung provider can never hold the locked transaction (and its
 *     pooled connection) open indefinitely — now roughly the entire
 *     connection-hold window.
 *  5. Ground the raw result against the known-path set (T4), re-validate
 *     with `Brief.parse()` (mandatory trust boundary for untrusted-derived
 *     LLM output — mirrors `intent/service.ts`), then cache it against the
 *     head read INSIDE the lock.
 *
 * No adapter/SDK imports here — every external capability (LLM, GitHub,
 * repo-intel, git) is reached through `container`, never directly.
 */

import { and, eq } from 'drizzle-orm';
import { Brief } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { buildBlast } from '../blast/service.js';
import { buildSmartDiff } from '../smart-diff/service.js';
import { ProjectContextService } from '../project-context/service.js';
import { BriefRepository } from './repository.js';
import { assembleBriefPayload, buildKnownPathSet, type BriefFacts } from './assembler.js';
import { groundBrief } from './grounding.js';

/**
 * Bounds the single Brief LLM call (M3). No LLM port method accepts an
 * `AbortSignal` (`StructuredRequest` has no `signal` field), and per-request
 * `timeoutMs` is inconsistently honoured across providers — the OpenAI and
 * Anthropic adapters race it internally (`platform/resilience.ts#withTimeout`)
 * but `OpenRouterProvider` only applies a client-constructor-level timeout
 * (90s default) and ignores per-request `timeoutMs` entirely. A local
 * `Promise.race` against a timer is therefore the one bound that is reliable
 * across every provider — the plan's documented fallback.
 */
export const BRIEF_LLM_TIMEOUT_MS = 60_000;

class BriefTimeoutError extends Error {
  constructor(ms: number) {
    super(`Brief generation timed out after ${ms}ms`);
    this.name = 'BriefTimeoutError';
  }
}

type PullFactsRow = { id: string; repoId: string; number: number };

export class BriefService {
  constructor(
    private container: Container,
    private repo: BriefRepository,
  ) {}

  /**
   * Generate (or serve cached) the Why+Risk Brief for a PR.
   *
   * `force` skips both cache-hit checks (unlocked + in-lock) but still takes
   * the advisory lock and always performs a fresh LLM call + cache overwrite
   * (AC-8) — including when queued behind another in-flight generation for
   * the same PR (a force request is never absorbed by a waiter's cache hit).
   */
  async generateBrief(
    prId: string,
    workspaceId: string,
    opts: { force?: boolean } = {},
  ): Promise<Brief> {
    const force = opts.force ?? false;

    // 1. Resolve + tenancy-guard the PR. repoId/number feed fact gathering.
    const [pull] = await this.container.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        number: t.pullRequests.number,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pull) throw new NotFoundError('Pull request not found');

    // 2. Unlocked fast path (M3, true double-check) — zero LLM calls, no
    //    transaction opened, on a cache hit against the current head_sha.
    if (!force) {
      const cached = await this.cachedIfFresh(this.repo, prId);
      if (cached) return cached;
    }

    // 3. Miss (or force) — gather facts + resolve the feature model BEFORE
    //    taking the lock (HIGH-2 fix, see class docstring). Nothing here
    //    needs the transaction and none of it calls the LLM, so it never
    //    pins a pooled connection.
    const facts = await this.gatherFacts(workspaceId, pull);
    const knownPaths = buildKnownPathSet(facts.blast, facts.smartDiff);
    const { userMessage } = assembleBriefPayload(facts);
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'risk_brief',
    );
    const llm = await this.container.llm(provider);

    // 4. Serialize on the PR-scoped advisory lock. Only the cache re-read,
    //    the single bounded LLM call, grounding, re-validation, and the
    //    upsert live inside — the connection-hold window is now roughly the
    //    LLM call itself.
    return this.repo.withPrLock(prId, async (tx) => {
      // A repository bound to THIS transaction's connection — the only way
      // to see the winner's just-committed row while still holding the lock
      // (postgres-js pools connections; the plain `this.repo` reads on the
      // pool, not this transaction).
      const txRepo = new BriefRepository(tx);

      // 4a. Re-read the cache inside the lock — a genuine waiter sees the
      //     winner's committed row and also makes zero LLM calls (AC-17).
      if (!force) {
        const cached = await this.cachedIfFresh(txRepo, prId);
        if (cached) return cached;
      }

      // 4b. Make EXACTLY ONE structured LLM call, bounded by
      //     BRIEF_LLM_TIMEOUT_MS (M3).
      let raw: Brief;
      try {
        const result = await Promise.race([
          llm.completeStructured<Brief>({
            model,
            schema: Brief,
            schemaName: 'Brief',
            messages: [{ role: 'user', content: userMessage }],
          }),
          new Promise<never>((_, reject) => {
            const handle = setTimeout(
              () => reject(new BriefTimeoutError(BRIEF_LLM_TIMEOUT_MS)),
              BRIEF_LLM_TIMEOUT_MS,
            );
            handle.unref?.();
          }),
        ]);
        raw = result.data;
      } catch (err) {
        // AC-9: deterministic error, no stack trace leaves this function; the
        // transaction (and thus the advisory lock + pooled connection) rolls
        // back on throw — cache stays intact because upsert never runs.
        throw new ExternalServiceError('Brief generation failed', {
          reason: err instanceof Error ? err.message : 'unknown error',
        });
      }

      // 4c. Grounding gate (AC-4/AC-5) — mechanical path-set check.
      const { brief: groundedRaw } = groundBrief(raw, knownPaths);

      // 4d. Mandatory re-validation before caching — the trust boundary for
      //     untrusted-derived LLM output (mirrors intent/service.ts:117). A
      //     parse failure is treated exactly like an LLM failure.
      let brief: Brief;
      try {
        brief = Brief.parse(groundedRaw);
      } catch (err) {
        throw new ExternalServiceError('Brief generation produced an invalid result', {
          reason: err instanceof Error ? err.message : 'unknown error',
        });
      }

      // 4e. Cache against the head read INSIDE the lock (not the one read in
      //     step 1) so a push that lands mid-generation can't cache a stale
      //     head.
      const headForCache = await txRepo.currentHead(prId);
      if (!headForCache) throw new NotFoundError('Pull request not found');
      await txRepo.upsert(prId, brief, headForCache);

      return brief;
    });
  }

  /**
   * A cache hit iff a Brief is stored, its head_sha is non-null (a null
   * head_sha means a legacy row predating the column — treated as a miss),
   * and it equals the PR's current head_sha.
   */
  private async cachedIfFresh(repo: BriefRepository, prId: string): Promise<Brief | null> {
    const [cache, currentHead] = await Promise.all([repo.read(prId), repo.currentHead(prId)]);
    if (cache.brief && cache.headSha && currentHead && cache.headSha === currentHead) {
      return cache.brief;
    }
    return null;
  }

  /**
   * Deterministically gather every Brief fact source. Each source is
   * independently best-effort: a failure or unavailable dependency simply
   * omits that field from `BriefFacts` — fact collection itself never
   * throws, and no LLM call happens in this stage (AC-3 cost).
   */
  private async gatherFacts(workspaceId: string, pull: PullFactsRow): Promise<BriefFacts> {
    const facts: BriefFacts = {};

    // Intent — persisted PR intent (already LLM-derived and re-validated at
    // its own persist boundary — read-only here).
    try {
      const row = await this.container.intentRepo.findByPrId(pull.id);
      if (row) {
        facts.intent = { summary: row.summary, in_scope: row.inScope, out_of_scope: row.outOfScope };
      }
    } catch {
      // omit on failure
    }

    // Blast radius — deterministic, server-computed.
    try {
      facts.blast = await buildBlast(this.container, workspaceId, pull.id);
    } catch {
      // omit on failure (buildBlast throws NotFoundError on a race where the
      // PR vanished between step 1 and here — degrade rather than fail
      // the whole Brief for a non-essential fact source)
    }

    // Smart Diff — deterministic, DB-only, zero LLM calls.
    try {
      facts.smartDiff = await buildSmartDiff(this.container.db, pull.id);
    } catch {
      // omit on failure
    }

    // Linked issue — best-effort GitHub fetch (mirrors intent/service.ts's
    // minimal linked-issue lookup, not the full PrDetail refresh route).
    try {
      const [repoRow] = await this.container.db
        .select({ owner: t.repos.owner, name: t.repos.name })
        .from(t.repos)
        .where(eq(t.repos.id, pull.repoId));
      if (repoRow) {
        const gh = await this.container.github();
        const detail = await gh.getPullRequest(
          { owner: repoRow.owner, name: repoRow.name },
          pull.number,
        );
        if (detail.linked_issue) facts.linkedIssue = detail.linked_issue;
      }
    } catch {
      // omit on failure — no token configured / offline / no linked issue
    }

    // Context-Folder specs attached to the repo's active review agent.
    try {
      const docs = await new ProjectContextService(this.container).readAttachedDocs(
        workspaceId,
        pull.repoId,
      );
      if (docs.length > 0) facts.specs = docs;
    } catch {
      // omit on failure — no active agent / no attachments / read error
    }

    return facts;
  }
}
