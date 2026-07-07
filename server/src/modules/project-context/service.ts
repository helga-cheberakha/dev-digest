/**
 * Project Context discovery service (T7 — AC-1, AC-2, AC-3, AC-4, AC-8, AC-9).
 *
 * Responsibilities:
 *  - Discover .md files under specs/docs/insights in a repo clone (stat-only).
 *  - Degrade gracefully when the clone is absent (never throw).
 *  - Read and confine a single document for preview (AC-8).
 *
 * Both methods are pure application-layer orchestration: all I/O goes through
 * `container.git` (GitClient port) and `container.agentsRepo` (repository).
 * The only direct OS call is a `stat` used to differentiate "clone missing"
 * from "no context docs" before calling the port. This keeps the onion
 * boundary: the port is the gate for git operations; stat is just existence
 * detection that the port does not expose.
 */

import { stat } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import type { DiscoveredDocument, DiscoveryResponse, DocumentPreview } from '@devdigest/shared';
import {
  CONTEXT_ROOT_FOLDERS,
  MAX_DISCOVERED_FILES,
  type FolderKind,
} from './constants.js';
import { guardPath } from './path-guard.js';

export class ProjectContextService {
  constructor(private container: Container) {}

  // ---------------------------------------------------------------------------
  // discoverDocuments — AC-1, AC-2, AC-3, AC-4, AC-9
  // ---------------------------------------------------------------------------

  /**
   * Discover all `.md` files under `specs/`, `docs/`, and `insights/` in the
   * given repo's clone. Returns an empty list with a `reason` when the clone is
   * missing (AC-3). Never throws.
   *
   * Caps output at `MAX_DISCOVERED_FILES` and sets `truncated: true` when the
   * real set would exceed the cap (AC-4).
   */
  async discoverDocuments(workspaceId: string, repoId: string): Promise<DiscoveryResponse> {
    // 1. Resolve the repo row (workspace-scoped tenancy guard).
    const [repo] = await this.container.db
      .select({ owner: t.repos.owner, name: t.repos.name })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));

    if (!repo) {
      return { documents: [], truncated: false, reason: 'Repository not found.' };
    }

    const repoRef = { owner: repo.owner, name: repo.name };
    const clonePath = this.container.git.clonePathFor(repoRef);

    // 2. Check clone existence before walking. listDocs() also returns [] on a
    //    missing clone, but we need to produce a meaningful `reason` (AC-3).
    try {
      await stat(clonePath);
    } catch {
      return {
        documents: [],
        truncated: false,
        reason: 'Repository has not been cloned yet — sync may be pending.',
      };
    }

    // 3. Walk for .md files. Request one extra entry to detect truncation without
    //    a second pass.
    const raw = await this.container.git.listDocs(repoRef, {
      maxFiles: MAX_DISCOVERED_FILES + 1,
    });

    // 4. Filter to context root folders only (AC-1: specs / docs / insights).
    //    listDocs returns ALL .md files from the whole clone; the service limits
    //    the scope to the configured root folders here.
    const filtered = raw.filter((entry) => {
      const firstSegment = entry.path.split('/')[0];
      return (CONTEXT_ROOT_FOLDERS as readonly string[]).includes(firstSegment ?? '');
    });

    // 5. Apply the cap and derive the truncation flag.
    const truncated = filtered.length > MAX_DISCOVERED_FILES;
    const capped = filtered.slice(0, MAX_DISCOVERED_FILES);

    // 6. Map each entry to DiscoveredDocument.
    //    `est_tokens` = ceil(sizeBytes / 4) — the same heuristic as approxTokens
    //    (adapters/tokenizer/index.ts:21), applied to file size instead of char
    //    count (stat-only; file bodies are never opened here, AC-2).
    //    `used_by_agents` is fetched through the container (cross-module, AC-9).
    const documents: DiscoveredDocument[] = await Promise.all(
      capped.map(async (entry): Promise<DiscoveredDocument> => {
        const parts = entry.path.split('/');
        const name = parts[parts.length - 1] ?? entry.path;
        const parent_path = parts.slice(0, -1).join('/');
        const folder_kind = parts[0] as FolderKind;
        const est_tokens = Math.ceil(entry.sizeBytes / 4);
        const used_by_agents = await this.container.agentsRepo.usedByAgentsCount(
          entry.path,
        );

        return {
          path: entry.path,
          parent_path,
          name,
          folder_kind,
          size_bytes: entry.sizeBytes,
          est_tokens,
          used_by_agents,
        };
      }),
    );

    return { documents, truncated };
  }

  // ---------------------------------------------------------------------------
  // previewDocument — AC-8 (confinement), AC-19..AC-21 (UI preview source)
  // ---------------------------------------------------------------------------

  /**
   * Read the raw markdown content of a single document for client-side preview.
   *
   * Uses `guardPath` (T2) to enforce confinement: absolute paths, `..`
   * traversal, non-`.md` files, out-of-root-folder paths, and symlink escapes
   * are all rejected before any file is read (AC-8).
   *
   * Resolves the active repo for the workspace (single-repo scan decision).
   * Returns a discriminated union so the route can return 422 on rejection
   * without a try/catch.
   */
  async previewDocument(
    workspaceId: string,
    candidatePath: string,
  ): Promise<{ ok: true; document: DocumentPreview } | { ok: false; reason: string }> {
    // 1. Resolve the active repo for this workspace (single-repo scan decision).
    const [repo] = await this.container.db
      .select({ owner: t.repos.owner, name: t.repos.name })
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId))
      .limit(1);

    if (!repo) {
      return { ok: false, reason: 'No repository configured for this workspace.' };
    }

    const repoRef = { owner: repo.owner, name: repo.name };
    const clonePath = this.container.git.clonePathFor(repoRef);

    // 2. Confine the path (AC-8).
    const guard = await guardPath(candidatePath, clonePath);
    if (!guard.ok) {
      return { ok: false, reason: guard.reason };
    }

    // 3. Read the file via the GitClient port (never raw fs in the service).
    try {
      const content = await this.container.git.readFile(repoRef, guard.path);
      return { ok: true, document: { path: guard.path, content } };
    } catch {
      return { ok: false, reason: 'File could not be read.' };
    }
  }
}
