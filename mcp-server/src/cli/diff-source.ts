/**
 * Diff acquisition port — the `DiffSource` interface and its factory.
 *
 * The CLI composition root depends on this interface only; concrete adapters
 * live under `./diff-sources/`. The factory wires the two together and is the
 * only place that knows both the port and its adapter — consistent with the
 * onion-architecture composition-root rule.
 */

import { WorkingTreeDiffSource } from './diff-sources/working.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All diff modes the CLI understands (only `'working'` is implemented now). */
export const DIFF_MODES = ['working', 'staged', 'branch'] as const;
export type DiffMode = (typeof DIFF_MODES)[number];

/** Port: anything that can produce a raw unified-diff string on demand. */
export interface DiffSource {
  acquire(): Promise<string>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the working directory is not inside a git repository.
 * Callers can narrow on `err.code === 'not_a_repo'` for a specific message.
 */
export class GitNotARepoError extends Error {
  readonly code = 'not_a_repo' as const;

  constructor(cwd: string) {
    super(`Not a git repository (or any parent): ${cwd}`);
    this.name = 'GitNotARepoError';
  }
}

/**
 * Thrown when `git diff` exits non-zero for any reason other than
 * "not a git repository". Wraps the stderr text for diagnosis.
 */
export class GitDiffError extends Error {
  constructor(stderr: string) {
    super(`git diff failed: ${stderr}`);
    this.name = 'GitDiffError';
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct the appropriate `DiffSource` for the given `mode`.
 *
 * @param mode - Which diff to capture. Only `'working'` is implemented.
 * @param cwd  - Absolute path to the git repository root (or any subdirectory).
 * @throws {Error} for modes that are not yet implemented (`'staged'`, `'branch'`).
 */
export function createDiffSource(mode: DiffMode, cwd: string): DiffSource {
  switch (mode) {
    case 'working':
      return new WorkingTreeDiffSource(cwd);

    case 'staged':
    case 'branch':
      throw new Error(`DiffMode "${mode}" is not yet implemented`);

    default:
      // Unreachable when `mode` is a validated DiffMode; guards raw CLI input.
      throw new Error(
        `Unknown diff mode "${String(mode)}". Choose: ${DIFF_MODES.join(' | ')}`,
      );
  }
}
