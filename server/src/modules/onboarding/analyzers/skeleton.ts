/**
 * skeleton.ts — Deterministic OnboardingArtifact skeleton builder.
 *
 * Used on the degraded path (index absent/degraded) and on LLM-failure paths so
 * the caller always returns a valid, schema-conforming OnboardingArtifact — never
 * an empty result (AC-8, R6).
 *
 * Fallback rules (degraded / non-JS / empty import graph):
 *  - Architecture nodes: top-level directories from the clone (passed in by the
 *    service), each mapped to a `kind:'file'` node; empty when no dirs available.
 *  - Reading/critical seeds: README + package-manifest entrypoint paths passed
 *    in by the service; empty when those files are absent.
 *  - How-to-run: always from the T3 howToRun analyzer, which works from whatever
 *    clone files exist (no index needed).
 *  - firstTasks: omitted (undefined) — no genuine gap detection on degraded path.
 *
 * Sections with no available facts render as empty arrays, which is valid under
 * the no-.min() schema (AC-8 guarantee).
 *
 * Pure function — no I/O.
 */

import type {
  OnboardingArtifact,
  OnboardingNode,
  OnboardingEdge,
  CriticalPathEntry,
  HowToRunStep,
  ReadingPathEntry,
} from '@devdigest/shared';

// ---- Constants ----

/** Degraded overview message when no index is available. */
const DEGRADED_OVERVIEW =
  'The repository index is unavailable. Architecture information could not be ' +
  'derived automatically. The facts below are based on directory structure and ' +
  'entrypoint heuristics only.';

/** Overview text when the LLM failed but index facts are present. */
const NARRATIVE_UNAVAILABLE_OVERVIEW =
  'Narrative generation is temporarily unavailable. The sections below are ' +
  'derived deterministically from the repository index and clone contents.';

/** Node cap for architecture diagram (mirrors the 5–8 cap from the spec). */
const ARCH_NODE_CAP = 8;

// ---- Input shape ----

/**
 * All inputs the caller must supply.  The service (T10) is responsible for
 * gathering available facts and deciding which flags to set.
 */
export interface SkeletonInput {
  // Required metadata
  repoName: string;
  headSha: string;
  filesIndexed: number;
  /** "owner/repo" — used to build GitHub blob links for seed entries. */
  fullName: string;

  // Caller-controlled flags (mutually exclusive by convention):
  //   degraded        — index absent/degraded; use directory/entrypoint heuristics
  //   narrativeUnavailable — LLM failed; deterministic facts are present
  degraded?: boolean;
  degradedReason?: string;
  narrativeUnavailable?: boolean;

  // Available deterministic facts from analyzers (may be absent in degraded mode)
  howToRun: HowToRunStep[];
  architectureNodes?: OnboardingNode[];
  architectureEdges?: OnboardingEdge[];
  criticalPaths?: CriticalPathEntry[];
  readingPath?: ReadingPathEntry[];

  // Fallback seed inputs for degraded / empty-import-graph case (T8 plan)
  /**
   * Top-level directories from the clone — used as architecture nodes when the
   * import graph is empty or unavailable (non-JS repos, degraded index).
   */
  topLevelDirs: string[];
  /**
   * File paths of README and package-manifest entrypoints (e.g. 'README.md',
   * 'package.json', 'Cargo.toml') — used as reading-path and critical-path
   * seeds when the indexer cannot provide ranked files.
   */
  readingSeeds: string[];
}

// ---- Helpers ----

/** Construct a GitHub blob URL from fullName + headSha + filePath. */
function buildLink(fullName: string, headSha: string, filePath: string): string {
  return `https://github.com/${fullName}/blob/${headSha}/${filePath}`;
}

/**
 * Build architecture nodes from top-level directories for the degraded path.
 * Caps at ARCH_NODE_CAP to satisfy AC-11's 5–8 node rule.
 * Returns an empty array when no directories are available.
 */
function buildFallbackNodes(topLevelDirs: string[]): OnboardingNode[] {
  const dirs = topLevelDirs.slice(0, ARCH_NODE_CAP);
  return dirs.map((dir) => ({
    id: dir,
    label: dir,
    kind: 'file' as const,  // directories shown as 'file' nodes on degraded path
  }));
}

/**
 * Build reading-path entries from seed file paths.
 * Caps at 5 to respect the schema `.max(5)`.
 */
function buildFallbackReadingPath(
  readingSeeds: string[],
  fullName: string,
  headSha: string,
): ReadingPathEntry[] {
  return readingSeeds.slice(0, 5).map((file) => ({
    file,
    rationale:
      'Key entrypoint file — start here to understand the project structure.',
    link: buildLink(fullName, headSha, file),
  }));
}

/**
 * Build critical-path entries from seed file paths.
 * Caps at 8 to respect the schema `.max(8)`.
 */
function buildFallbackCriticalPaths(
  readingSeeds: string[],
  fullName: string,
  headSha: string,
): CriticalPathEntry[] {
  return readingSeeds.slice(0, 8).map((file) => ({
    file,
    rationale: 'Primary entrypoint — review before exploring other files.',
    link: buildLink(fullName, headSha, file),
  }));
}

// ---- Public API ----

/**
 * Assemble a deterministic OnboardingArtifact skeleton from whatever facts are
 * available.  Always passes `OnboardingArtifact.parse()` even with 0-entry
 * sections (no `.min()` in the schema).
 *
 * The caller controls the `degraded`/`degradedReason`/`narrativeUnavailable`
 * flags; this function only assembles — it does not re-decide the degradation
 * state.
 */
export function buildSkeleton(input: SkeletonInput): OnboardingArtifact {
  const {
    repoName,
    headSha,
    filesIndexed,
    fullName,
    degraded,
    degradedReason,
    narrativeUnavailable,
    howToRun,
    architectureNodes,
    architectureEdges,
    criticalPaths,
    readingPath,
    topLevelDirs,
    readingSeeds,
  } = input;

  const isDegraded = degraded === true;

  // Architecture nodes: prefer analyzer output; fall back to dir heuristics
  const nodes: OnboardingNode[] =
    architectureNodes && architectureNodes.length > 0
      ? architectureNodes
      : buildFallbackNodes(topLevelDirs);

  // Architecture edges: prefer analyzer output; fall back to empty
  const edges: OnboardingEdge[] =
    architectureEdges && architectureEdges.length > 0 ? architectureEdges : [];

  // Critical paths: prefer analyzer output; fall back to reading seeds
  const resolvedCriticalPaths: CriticalPathEntry[] =
    criticalPaths && criticalPaths.length > 0
      ? criticalPaths
      : buildFallbackCriticalPaths(readingSeeds, fullName, headSha);

  // Reading path: prefer analyzer output; fall back to reading seeds
  const resolvedReadingPath: ReadingPathEntry[] =
    readingPath && readingPath.length > 0
      ? readingPath
      : buildFallbackReadingPath(readingSeeds, fullName, headSha);

  // Architecture overview: meaningful message based on the degradation mode
  const overviewText = isDegraded ? DEGRADED_OVERVIEW : NARRATIVE_UNAVAILABLE_OVERVIEW;

  const artifact: OnboardingArtifact = {
    repoName,
    filesIndexed,
    generatedAt: new Date().toISOString(),
    headSha,
    ...(degraded !== undefined ? { degraded } : {}),
    ...(degradedReason !== undefined ? { degradedReason } : {}),
    ...(narrativeUnavailable !== undefined ? { narrativeUnavailable } : {}),
    sections: {
      architecture: {
        overview: overviewText,
        style: 'unknown',
        diagram: {
          nodes,
          edges,
        },
      },
      criticalPaths: resolvedCriticalPaths,
      howToRun,
      readingPath: resolvedReadingPath,
      // firstTasks is omitted on the skeleton path — no genuine gap detection
      // has been performed, so we must not fabricate tasks (AC-13).
      firstTasks: undefined,
    },
  };

  return artifact;
}
