/**
 * Configuration constants for the Project Context feature.
 * These are the server-side tunable defaults for document discovery and
 * run-time injection caps. All values are safe to import from any layer.
 */

/** Root folder names that are scanned for context documents (AC-1). */
export const CONTEXT_ROOT_FOLDERS = ['specs', 'docs', 'insights'] as const;

export type FolderKind = (typeof CONTEXT_ROOT_FOLDERS)[number];

/** Maximum number of discovered files returned before truncation (AC-4). */
export const MAX_DISCOVERED_FILES = 500;

/** Per-document character cap for run-time injection (AC-14). */
export const PER_DOC_CHAR_CAP = 20_000;

/** Total Project-context block character budget for run-time injection (AC-15). */
export const TOTAL_BLOCK_CHAR_CAP = 40_000;
