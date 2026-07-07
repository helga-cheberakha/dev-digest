/**
 * Path-guard helper — enforces confinement of candidate document paths to the
 * repo clone root (AC-8, AC-13).
 *
 * Rules applied in order:
 *  1. Reject absolute paths.
 *  2. Reject any path containing `..` segments (lexical traversal).
 *  3. Require a `.md` extension.
 *  4. Require the path to start with one of the configured root-folder segments.
 *  5. Resolve the **real path** (symlinks followed) of the joined candidate and
 *     verify it remains inside the real path of the clone root — defense against
 *     symlink escapes.
 *
 * Returns a discriminated union so callers can skip-and-log without try/catch.
 * The resolved `path` on success is the input candidate normalised to POSIX
 * (forward-slashes, no trailing slash, no double slashes).
 */

import { realpath } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { CONTEXT_ROOT_FOLDERS } from './constants.js';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export type GuardOk = { ok: true; path: string };
export type GuardFail = { ok: false; reason: string };
export type GuardResult = GuardOk | GuardFail;

// ---------------------------------------------------------------------------
// Helper: normalise a path to POSIX style (forward slashes, no trailing slash)
// ---------------------------------------------------------------------------
function toPosix(p: string): string {
  return p.split(sep).join('/').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Guard a repo-relative `candidate` path against the `cloneRoot` directory.
 *
 * @param candidate - A repo-relative path string submitted by the client.
 * @param cloneRoot - The absolute path to the repo clone on the server.
 * @returns `{ ok: true, path }` with the POSIX-normalised path, or
 *          `{ ok: false, reason }` explaining why the path was rejected.
 */
export async function guardPath(
  candidate: string,
  cloneRoot: string,
): Promise<GuardResult> {
  // 1. Reject absolute paths.
  if (candidate.startsWith('/') || /^[A-Za-z]:[/\\]/.test(candidate)) {
    return { ok: false, reason: 'absolute paths are not allowed' };
  }

  // 2. Reject lexical traversal: any segment that is exactly `..`.
  const segments = candidate.replace(/\\/g, '/').split('/');
  if (segments.some((s) => s === '..')) {
    return { ok: false, reason: 'path traversal via ".." is not allowed' };
  }

  // 3. Require `.md` extension.
  if (!candidate.toLowerCase().endsWith('.md')) {
    return { ok: false, reason: 'only .md files are allowed' };
  }

  // 4. Require the first non-empty segment to be a configured root folder.
  const firstSegment = segments.find((s) => s.length > 0);
  if (
    !firstSegment ||
    !(CONTEXT_ROOT_FOLDERS as readonly string[]).includes(firstSegment)
  ) {
    return {
      ok: false,
      reason: `path must be under one of: ${CONTEXT_ROOT_FOLDERS.join(', ')}`,
    };
  }

  // 5. Resolve real paths and verify confinement (symlink escape defence).
  const candidateAbs = join(cloneRoot, normalize(candidate));

  let realCloneRoot: string;
  let realCandidate: string;

  try {
    realCloneRoot = await realpath(cloneRoot);
  } catch {
    return { ok: false, reason: 'clone root could not be resolved' };
  }

  try {
    realCandidate = await realpath(candidateAbs);
  } catch {
    // The file does not exist yet (or is unreadable). We cannot verify
    // symlink confinement without a real path, so we reject conservatively.
    return {
      ok: false,
      reason: 'candidate path could not be resolved (file missing or unreadable)',
    };
  }

  // Ensure the real candidate is strictly inside the real clone root.
  // The trailing separator ensures `/clone` does not match `/cloneOther`.
  const rootWithSep = realCloneRoot.endsWith(sep)
    ? realCloneRoot
    : realCloneRoot + sep;

  if (
    realCandidate !== realCloneRoot &&
    !realCandidate.startsWith(rootWithSep)
  ) {
    return {
      ok: false,
      reason: 'path resolves outside the clone root (possible symlink escape)',
    };
  }

  return { ok: true, path: toPosix(candidate) };
}
