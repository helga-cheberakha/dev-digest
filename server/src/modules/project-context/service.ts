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
import { and, asc, eq } from 'drizzle-orm';
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

    // 3. Walk for .md files matching `**/{specs,docs,insights}/**/*.md` (AC-1).
    //    The root-folder filter runs INSIDE the walk (`includeSegments`), so
    //    `maxFiles` counts only matching files — a clone full of unrelated .md
    //    files cannot exhaust the cap and silently drop context docs (AC-4).
    //    One extra entry detects truncation without a second pass.
    const raw = await this.container.git.listDocs(repoRef, {
      maxFiles: MAX_DISCOVERED_FILES + 1,
      includeSegments: [...CONTEXT_ROOT_FOLDERS],
    });

    // 4. Defense-in-depth re-filter (adapter contract already guarantees this).
    const filtered = raw.filter((entry) => {
      const segments = entry.path.split('/');
      return segments.some((s) => (CONTEXT_ROOT_FOLDERS as readonly string[]).includes(s));
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
        // folder_kind: nearest (deepest/rightmost) matching ancestor segment.
        // For `specs/sub/api.md` → 'specs'; for `packages/api/docs/guide.md` → 'docs'.
        const nearestFolderKindSegment = parts
          .slice()
          .reverse()
          .find((s) => (CONTEXT_ROOT_FOLDERS as readonly string[]).includes(s));
        const folder_kind = (nearestFolderKindSegment ?? parts[0]) as FolderKind;
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
    repoId?: string,
  ): Promise<{ ok: true; document: DocumentPreview } | { ok: false; reason: string }> {
    // 1. Resolve the repo. When repoId is provided, scope exactly to that repo
    //    (workspace-scoped). When absent, use a deterministic fallback: ORDER BY
    //    created_at and prefer the first whose clone directory exists on disk.
    let repo: { owner: string; name: string } | undefined;

    if (repoId) {
      const [row] = await this.container.db
        .select({ owner: t.repos.owner, name: t.repos.name })
        .from(t.repos)
        .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
      repo = row;
    } else {
      const rows = await this.container.db
        .select({ owner: t.repos.owner, name: t.repos.name })
        .from(t.repos)
        .where(eq(t.repos.workspaceId, workspaceId))
        .orderBy(asc(t.repos.createdAt));

      for (const row of rows) {
        const clonePath = this.container.git.clonePathFor({ owner: row.owner, name: row.name });
        try {
          await stat(clonePath);
          repo = row;
          break;
        } catch {
          // clone not present — try next repo
        }
      }
      // Fall back to the oldest repo even if its clone doesn't exist yet.
      if (!repo && rows.length > 0) {
        repo = rows[0];
      }
    }

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

  // ---------------------------------------------------------------------------
  // readAttachedDocs — Why+Risk Brief fact source (brief/service.ts)
  // ---------------------------------------------------------------------------

  /**
   * Read the Context-Folder documents attached to the repo's active review
   * agent, for injection into the Why+Risk Brief prompt (`brief/service.ts`).
   *
   * "Active review agent" has no dedicated flag in the schema — agents are
   * workspace-scoped, not repo-scoped, so this resolves the oldest ENABLED
   * agent in the workspace (`ORDER BY created_at ASC LIMIT 1`), the same
   * heap-order-nondeterminism fix already applied to repo resolution
   * elsewhere in this service (server/INSIGHTS.md 2026-07-07).
   *
   * Best-effort throughout, per the spec's fact-source contract: returns `[]`
   * (never throws) when the repo isn't found, there is no enabled agent, the
   * agent has no attached documents, or every attached path fails to read.
   * A single unreadable/guard-rejected document is skipped, not fatal to the
   * rest.
   */
  async readAttachedDocs(workspaceId: string, repoId: string): Promise<DocumentPreview[]> {
    // 1. Resolve the repo (workspace-scoped tenancy guard).
    const [repo] = await this.container.db
      .select({ owner: t.repos.owner, name: t.repos.name })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    if (!repo) return [];

    // 2. Resolve the workspace's active review agent (deterministic fallback).
    const [agent] = await this.container.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)))
      .orderBy(asc(t.agents.createdAt))
      .limit(1);
    if (!agent) return [];

    // 3. The agent's attached document paths, in attachment order.
    let paths: string[];
    try {
      paths = await this.container.agentsRepo.documentsForAgent(agent.id);
    } catch {
      return [];
    }
    if (paths.length === 0) return [];

    const repoRef = { owner: repo.owner, name: repo.name };
    const clonePath = this.container.git.clonePathFor(repoRef);

    // 4. Confine + read each path; skip individual failures (never fatal).
    const docs: DocumentPreview[] = [];
    for (const path of paths) {
      const guard = await guardPath(path, clonePath);
      if (!guard.ok) continue;
      try {
        const content = await this.container.git.readFile(repoRef, guard.path);
        docs.push({ path: guard.path, content });
      } catch {
        // per-doc read failure — skip, best-effort
      }
    }
    return docs;
  }

  // ---------------------------------------------------------------------------
  // saveDocument — AC-30, AC-31, AC-32
  // ---------------------------------------------------------------------------

  /**
   * Write new content to an existing context document in the clone worktree.
   *
   * Applies the same `guardPath` confinement as `previewDocument` (AC-30):
   *  - `.md` only, under a context root folder, no `..`, no absolute paths,
   *    no symlink escapes; the file MUST already exist (realpath rejects missing
   *    files — blocks new-file creation without a separate check).
   *
   * Writes go through `container.git.writeFile` — never raw `fs` in the service.
   * The adapter implements temp+rename so a mid-write crash leaves no partial
   * file (AC-32).
   *
   * Returns a discriminated union so the route can 422 on rejection (AC-32).
   */
  async saveDocument(
    workspaceId: string,
    candidatePath: string,
    content: string,
    repoId?: string,
  ): Promise<{ ok: true; document: DocumentPreview } | { ok: false; reason: string }> {
    // 1. Resolve the repo — verbatim same logic as previewDocument to preserve
    //    the heap-order nondeterminism fix (server/INSIGHTS.md 2026-07-07).
    let repo: { owner: string; name: string } | undefined;

    if (repoId) {
      const [row] = await this.container.db
        .select({ owner: t.repos.owner, name: t.repos.name })
        .from(t.repos)
        .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
      repo = row;
    } else {
      const rows = await this.container.db
        .select({ owner: t.repos.owner, name: t.repos.name })
        .from(t.repos)
        .where(eq(t.repos.workspaceId, workspaceId))
        .orderBy(asc(t.repos.createdAt));

      for (const row of rows) {
        const clonePath = this.container.git.clonePathFor({ owner: row.owner, name: row.name });
        try {
          await stat(clonePath);
          repo = row;
          break;
        } catch {
          // clone not present — try next repo
        }
      }
      // Fall back to the oldest repo even if its clone doesn't exist yet.
      if (!repo && rows.length > 0) {
        repo = rows[0];
      }
    }

    if (!repo) {
      return { ok: false, reason: 'No repository configured for this workspace.' };
    }

    const repoRef = { owner: repo.owner, name: repo.name };
    const clonePath = this.container.git.clonePathFor(repoRef);

    // 2. Confine the path before any write (AC-30).
    const guard = await guardPath(candidatePath, clonePath);
    if (!guard.ok) {
      return { ok: false, reason: guard.reason };
    }

    // 3. Write via the GitClient port — never raw fs in the service.
    //    The adapter (SimpleGitClient) uses temp+rename for AC-32 atomicity.
    try {
      await this.container.git.writeFile(repoRef, guard.path, content);
      return { ok: true, document: { path: guard.path, content } };
    } catch {
      return { ok: false, reason: 'File could not be written.' };
    }
  }
}
