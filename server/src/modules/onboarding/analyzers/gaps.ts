/**
 * analyzers/gaps.ts — deterministic gap-detection heuristics.
 *
 * PURE and I/O-free. The service (T10) performs all clone reads, file-existence
 * checks, and convention comparisons, then calls `detectGaps` with the
 * pre-collected facts. This module only decides.
 *
 * Three heuristics (advisory, deterministic):
 *   (a) missing_test     — a top-ranked source file with no sibling / __tests__ test file.
 *   (b) missing_doc      — a top-ranked file whose exported symbols lack JSDoc/TSDoc.
 *   (c) missing_convention — a top-ranked file that diverges from an accepted convention.
 *
 * Returns `[]` when nothing is genuinely detected.
 * NEVER fabricates a gap to hit a quota.
 *
 * firstTasks.ts (T6) consumes the returned Gap[] and formats 2-3 First-task cards,
 * or emits an honest-omission signal when the list is empty.
 */

import * as nodePath from 'node:path';

// ---- Gap types -------------------------------------------------------

/** The three deterministic gap categories. Matches FirstTaskEntry.gapType. */
export type GapType = 'missing_test' | 'missing_doc' | 'missing_convention';

/**
 * A detected codebase gap, ready for formatting by firstTasks.ts.
 *
 * - `gapType`       → FirstTaskEntry.gapType
 * - `path`          → FirstTaskEntry.suggestedPath (the file that needs attention)
 * - `patternPointer` → FirstTaskEntry.patternPointer
 * - `evidence`      → basis for FirstTaskEntry.rationale
 */
export interface Gap {
  /** Category of the gap. */
  gapType: GapType;
  /**
   * Repository-relative path of the file that has the gap.
   *   missing_test      — the source file that needs a test.
   *   missing_doc       — the under-documented file.
   *   missing_convention — the diverging file.
   */
  path: string;
  /**
   * Human-readable pointer to the convention, doc standard, or test pattern
   * that would close this gap (e.g. "add a *.test.ts sibling file").
   */
  patternPointer: string;
  /**
   * One-sentence factual explanation of the evidence that triggered this gap.
   * MUST be grounded in the inputs — never invented.
   */
  evidence: string;
}

// ---- Input types -----------------------------------------------------

/** A ranked source file from getTopFilesByRank. */
export interface RankedFile {
  /** Repository-relative path (e.g. "src/modules/foo/service.ts"). */
  path: string;
  /** PageRank-derived rank score. Higher = more import-central. */
  rank: number;
}

/**
 * Inputs assembled by the service (T10) and passed to detectGaps.
 *
 * All I/O (clone reads, file-existence checks, convention comparison) is done
 * by the calling service before invoking detectGaps. detectGaps is I/O-free.
 */
export interface GapDetectionInputs {
  /**
   * Top-ranked source files (bounded candidate set from getTopFilesByRank).
   * The service should exclude test/config files before passing; detectGaps
   * applies an additional defensive filter (see isSourceFile).
   */
  topRankedFiles: RankedFile[];

  /**
   * File-existence predicate built from the service's clone checks.
   * Returns true when the repository-relative path exists in the clone.
   *
   * The service bulk-resolves likely test-file candidates and encodes the
   * result before constructing this predicate, so it remains pure here.
   */
  fileExists: (path: string) => boolean;

  /**
   * Pre-computed doc-coverage status per file.
   *   false   = service confirmed the file has exported symbols without JSDoc/TSDoc.
   *   true    = adequate coverage found.
   *   (absent) = not checked; the missing_doc heuristic is skipped for that file.
   */
  docCoverage: Record<string, boolean>;

  /**
   * Convention violations pre-detected by the service.
   * Each entry is a top-ranked file the service found to diverge from an
   * accepted convention after reading its content.
   */
  conventionViolations: Array<{
    /** Repository-relative path of the diverging file. */
    filePath: string;
    /** The accepted convention rule the file violates. */
    conventionRule: string;
    /**
     * Human-readable pointer to where the correct pattern can be found
     * (e.g. "convention #12 — see the Conventions tab").
     */
    patternPointer: string;
  }>;
}

// ---- Source-file detection ------------------------------------------

/**
 * File extensions treated as testable source files.
 * Non-source assets (.json, .md, .yaml, ...) are excluded from the test gap.
 */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx',
  '.mts', '.cts',
  '.js', '.jsx',
  '.mjs', '.cjs',
]);

/**
 * Path segments that indicate a file is itself a test or mock.
 * If the path contains any of these, it is not flagged for a missing test.
 */
const TEST_PATH_INDICATORS = [
  '.test.',
  '.spec.',
  '/__tests__/',
  '\\__tests__\\',
  '/__mocks__/',
  '\\__mocks__\\',
  '/test/',
  '/tests/',
  '/spec/',
];

/**
 * Returns true if `filePath` looks like a testable source file.
 * False for test files themselves, config files, and non-code assets.
 */
function isSourceFile(filePath: string): boolean {
  const ext = nodePath.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(ext)) return false;
  const normalised = filePath.replace(/\\/g, '/');
  return !TEST_PATH_INDICATORS.some((indicator) =>
    normalised.includes(indicator.replace(/\\/g, '/')),
  );
}

// ---- Test-candidate generation --------------------------------------

/** Test-file suffixes (inserted before the extension). */
const TEST_SUFFIXES = ['.test', '.spec'] as const;
/** Test-file extensions to probe (covers TS and JS repos). */
const TEST_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

/**
 * Returns the candidate test-file paths for a given source file.
 *
 * For `src/modules/foo/service.ts`, the candidates are:
 *   - src/modules/foo/service.test.ts   (and .tsx / .js / .jsx)
 *   - src/modules/foo/service.spec.ts   (and .tsx / .js / .jsx)
 *   - src/modules/foo/__tests__/service.test.ts  (and variants)
 *   - src/modules/foo/__tests__/service.spec.ts  (and variants)
 */
function testCandidatesFor(filePath: string): string[] {
  // Normalise to forward slashes for consistent joins.
  const normalised = filePath.replace(/\\/g, '/');
  const dir = normalised.includes('/')
    ? normalised.slice(0, normalised.lastIndexOf('/'))
    : '.';
  const ext = nodePath.extname(normalised);
  const base = nodePath.basename(normalised, ext);

  const candidates: string[] = [];
  for (const suffix of TEST_SUFFIXES) {
    for (const testExt of TEST_EXTENSIONS) {
      // Sibling test file: same directory.
      candidates.push(`${dir}/${base}${suffix}${testExt}`);
      // Nested __tests__ directory.
      candidates.push(`${dir}/__tests__/${base}${suffix}${testExt}`);
    }
  }
  return candidates;
}

// ---- Heuristic implementations ------------------------------------

/**
 * Heuristic (a): missing_test.
 *
 * A top-ranked source file is flagged when none of its candidate test paths
 * exist according to the `fileExists` predicate.
 *
 * Genuine evidence: `fileExists` returns false for ALL candidates.
 * The predicate is built by the service from real clone checks — never guessed.
 */
function detectMissingTests(
  topRankedFiles: RankedFile[],
  fileExists: (p: string) => boolean,
): Gap[] {
  const gaps: Gap[] = [];

  for (const { path: filePath } of topRankedFiles) {
    if (!isSourceFile(filePath)) continue;

    const candidates = testCandidatesFor(filePath);
    const hasTest = candidates.some((c) => fileExists(c));

    if (!hasTest) {
      gaps.push({
        gapType: 'missing_test',
        path: filePath,
        patternPointer:
          'Add a sibling *.test.ts file or a __tests__/ directory entry co-located with this module.',
        evidence: `Top-ranked source file "${filePath}" has no sibling or __tests__ test file.`,
      });
    }
  }

  return gaps;
}

/**
 * Heuristic (b): missing_doc.
 *
 * A top-ranked file is flagged when the service recorded `docCoverage[path] === false`,
 * meaning it found exported symbols with no JSDoc/TSDoc after reading the file content.
 *
 * Genuine evidence: the service explicitly set `docCoverage[path] = false`.
 * Files absent from `docCoverage` are silently skipped (coverage was not checked).
 */
function detectMissingDocs(
  topRankedFiles: RankedFile[],
  docCoverage: Record<string, boolean>,
): Gap[] {
  const gaps: Gap[] = [];

  for (const { path: filePath } of topRankedFiles) {
    if (docCoverage[filePath] === false) {
      gaps.push({
        gapType: 'missing_doc',
        path: filePath,
        patternPointer:
          'Add JSDoc/TSDoc block comments above every exported function, class, and type.',
        evidence: `Top-ranked file "${filePath}" has exported symbols without JSDoc/TSDoc documentation.`,
      });
    }
  }

  return gaps;
}

/**
 * Heuristic (c): missing_convention.
 *
 * Converts convention violations pre-detected by the service into Gap entries.
 *
 * Genuine evidence: the service read the file, compared it to accepted
 * conventions, and determined it diverges — recorded in `conventionViolations`.
 */
function detectConventionViolations(
  conventionViolations: GapDetectionInputs['conventionViolations'],
): Gap[] {
  return conventionViolations.map(({ filePath, conventionRule, patternPointer }) => ({
    gapType: 'missing_convention' satisfies GapType,
    path: filePath,
    patternPointer,
    evidence: `File "${filePath}" diverges from accepted convention: "${conventionRule}".`,
  }));
}

// ---- Public API -----------------------------------------------------

/**
 * Detects genuine codebase gaps from the pre-collected fact inputs.
 *
 * Returns an empty array when no gap is genuinely detected.
 * NEVER fabricates a gap to hit a quota.
 *
 * The caller (firstTasks.ts) handles the honest-omission path when this
 * returns `[]`.
 *
 * @param inputs - Pre-collected facts from the service (T10). No I/O here.
 * @returns     Array of detected gaps, ordered: missing_test → missing_doc → missing_convention.
 */
export function detectGaps(inputs: GapDetectionInputs): Gap[] {
  const { topRankedFiles, fileExists, docCoverage, conventionViolations } = inputs;

  return [
    ...detectMissingTests(topRankedFiles, fileExists),
    ...detectMissingDocs(topRankedFiles, docCoverage),
    ...detectConventionViolations(conventionViolations),
  ];
}
