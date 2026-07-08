/**
 * Context-doc loader for agent runs — assembles and injects attached Project
 * Context documents (specs / docs / insights) into the reviewer-core `specs`
 * input. Best-effort: any individual failure skips that document; the run is
 * never failed due to a context-doc problem (AC-12, best-effort enrichment
 * per server/CLAUDE.md).
 *
 * Order: agent-attached docs first, then each enabled skill's docs (in skill
 * order, then doc order within each skill). Duplicate paths (same normalised
 * path) are silently dropped — first occurrence wins (AC-10).
 *
 * Re-validates every path with `guardPath` against the PR's clone root at read
 * time as defense-in-depth against stale or tampered attachments (AC-13).
 */

import type { Container } from '../../platform/container.js';
import { guardPath } from '../project-context/path-guard.js';
import { PER_DOC_CHAR_CAP, TOTAL_BLOCK_CHAR_CAP } from '../project-context/constants.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result returned by loadContextDocs — the caller wires it into the run. */
export interface ContextLoaderResult {
  /** Assembled document bodies (one string per doc, after per-doc truncation). */
  specs: string[];
  /** Paths that were successfully read and injected (post-dedup, post-skip). */
  specsRead: string[];
  /** Paths skipped due to missing file, guard rejection, or non-UTF-8 content. */
  skipped: string[];
  /** Paths whose content was truncated to PER_DOC_CHAR_CAP (still injected). */
  truncated: string[];
  /** Paths dropped because the total budget was exhausted. */
  dropped: string[];
}

/**
 * Minimal logging interface that RunLogger satisfies.
 * `info` is used for all context-loader messages (enrichment is best-effort
 * and none of these are fatal).
 */
type ContextLog = {
  info(msg: string, data?: unknown): void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRUNCATION_MARKER = `\n\n[... document truncated at ${PER_DOC_CHAR_CAP.toLocaleString('en-US')} characters ...]`;

/** Unicode replacement character — Node places this when decoding invalid UTF-8 bytes. */
const REPLACEMENT_CHAR = '�';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a path for dedup comparison: POSIX-style, lowercase, collapsed slashes. */
function normalisePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Assemble Project Context documents for one agent run.
 *
 * @param container       - DI container (agentsRepo, skillsRepo, git).
 * @param cloneRoot       - Absolute path to the PR's repo clone on disk
 *                          (`container.git.clonePathFor(repoRef)`).
 * @param repoRef         - `{ owner, name }` used for `container.git.readFile`.
 * @param agentId         - The agent whose attached documents are loaded first.
 * @param enabledSkillIds - IDs of the agent's enabled, non-injection skills
 *                          (already filtered by the caller) — docs loaded in
 *                          this order after the agent's own docs.
 * @param log             - RunLogger (or any `{ info }` logger) for live-log output.
 */
export async function loadContextDocs(
  container: Container,
  cloneRoot: string,
  repoRef: { owner: string; name: string },
  agentId: string,
  enabledSkillIds: string[],
  log: ContextLog,
): Promise<ContextLoaderResult> {
  // -----------------------------------------------------------------------
  // 1. Collect ordered path candidates.
  //    Agent-attached paths come first; each skill's paths follow in skill order.
  // -----------------------------------------------------------------------
  const candidates: string[] = [];

  try {
    const agentPaths = await container.agentsRepo.documentsForAgent(agentId);
    candidates.push(...agentPaths);
  } catch (err) {
    log.info(
      `context-loader: could not fetch agent documents — ${(err as Error).message}`,
    );
  }

  for (const skillId of enabledSkillIds) {
    try {
      const skillPaths = await container.skillsRepo.documentsForSkill(skillId);
      candidates.push(...skillPaths);
    } catch (err) {
      log.info(
        `context-loader: could not fetch documents for skill ${skillId} — ${(err as Error).message}`,
      );
    }
  }

  if (candidates.length === 0) {
    return { specs: [], specsRead: [], skipped: [], truncated: [], dropped: [] };
  }

  // -----------------------------------------------------------------------
  // 2. Dedup — normalised path, first occurrence wins (AC-10).
  // -----------------------------------------------------------------------
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const p of candidates) {
    const key = normalisePath(p);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(p);
    }
  }

  // -----------------------------------------------------------------------
  // 3. Read + guard + cap each path.
  // -----------------------------------------------------------------------
  const specs: string[] = [];
  const specsRead: string[] = [];
  const skipped: string[] = [];
  const truncated: string[] = [];
  const dropped: string[] = [];

  let totalChars = 0;
  let budgetExhausted = false;

  for (const path of deduped) {
    // Once the total budget is exhausted, drop remaining without reading (AC-15).
    if (budgetExhausted) {
      dropped.push(path);
      continue;
    }

    // Re-validate against the PR's clone root (AC-13 — defense in depth).
    const guard = await guardPath(path, cloneRoot);
    if (!guard.ok) {
      log.info(`context-loader: skipping "${path}" — ${guard.reason}`);
      skipped.push(path);
      continue;
    }

    // Read the file; any error skips this doc (AC-12 — best-effort).
    let content: string;
    try {
      content = await container.git.readFile(repoRef, path);
    } catch (err) {
      log.info(
        `context-loader: skipping unreadable "${path}" — ${(err as Error).message}`,
      );
      skipped.push(path);
      continue;
    }

    // Skip non-UTF-8 files: Node's 'utf8' decode replaces invalid bytes with U+FFFD.
    if (content.includes(REPLACEMENT_CHAR)) {
      log.info(`context-loader: skipping non-UTF-8 file "${path}"`);
      skipped.push(path);
      continue;
    }

    // Per-doc truncation (AC-14).
    let docContent = content;
    if (docContent.length > PER_DOC_CHAR_CAP) {
      docContent = docContent.slice(0, PER_DOC_CHAR_CAP) + TRUNCATION_MARKER;
      truncated.push(path);
      log.info(
        `context-loader: "${path}" truncated (${content.length} → ${PER_DOC_CHAR_CAP} chars)`,
      );
    }

    // Total budget cap (AC-15): drop this doc and mark budget exhausted.
    if (totalChars + docContent.length > TOTAL_BLOCK_CHAR_CAP) {
      dropped.push(path);
      budgetExhausted = true;
      log.info(
        `context-loader: budget exhausted (${totalChars}/${TOTAL_BLOCK_CHAR_CAP} chars) — dropping "${path}" and remainder`,
      );
      continue;
    }

    totalChars += docContent.length;
    specs.push(docContent);
    specsRead.push(path);
  }

  if (dropped.length > 0) {
    log.info(
      `context-loader: ${dropped.length} document(s) dropped — total budget (${TOTAL_BLOCK_CHAR_CAP} chars) reached`,
    );
  }

  return { specs, specsRead, skipped, truncated, dropped };
}
