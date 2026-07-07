/**
 * analyzers/firstTasks.ts — Format detected gaps as First-task cards.
 *
 * PURE and I/O-free. Consumes a Gap[] produced by gaps.ts (T6b) and emits
 * 2–3 FirstTaskEntry items for the onboarding tour's "First tasks" section,
 * or an honest omission signal when no gap was detected.
 *
 * CONTRACT:
 *   - Never fabricates a task. If detectGaps() returned [], this function
 *     returns { kind: 'omitted', reason: '…' } — not a placeholder entry.
 *   - Capped at MAX_TASKS (3) entries to satisfy schema .max(3).
 *   - The gap list is taken as-is; re-deriving or re-detecting gaps here is
 *     explicitly forbidden per the plan.
 */

import type { FirstTaskEntry } from '@devdigest/shared';
import type { Gap, GapType } from './gaps.js';

// ---- Constants --------------------------------------------------------

/** Maximum tasks to emit (matches schema .max(3)). */
const MAX_TASKS = 3;

// ---- Return type (discriminated union) --------------------------------

/**
 * Success branch: at least one gap was detected and formatted as tasks.
 *
 * `tasks.length` is 1..MAX_TASKS. The service (T10) asserts ≥ 2 on the
 * happy path; the schema only enforces .max(3), so a single-task result
 * is technically valid at the schema level.
 */
export interface FirstTasksPresent {
  kind: 'tasks';
  tasks: FirstTaskEntry[];
}

/**
 * Omission branch: no gap was detected. The service (T10) uses `reason`
 * as the basis for a user-facing note and omits the firstTasks section from
 * the artifact (firstTasks is optional in the schema).
 *
 * Never returned when a gap exists — the two branches are mutually exclusive.
 */
export interface FirstTasksOmitted {
  kind: 'omitted';
  /**
   * Honest, human-readable explanation of why there are no first tasks.
   * Must not imply fabrication or apologise — state the fact plainly.
   */
  reason: string;
}

/** Discriminated union returned by buildFirstTasks. */
export type FirstTasksResult = FirstTasksPresent | FirstTasksOmitted;

// ---- Title / complexity derivation ------------------------------------

/**
 * Human-readable task title for each gap category.
 * Deterministic — same gapType always produces the same title prefix,
 * personalised by the file path.
 */
function titleFor(gapType: GapType, suggestedPath: string): string {
  const base = suggestedPath.split('/').pop() ?? suggestedPath;
  switch (gapType) {
    case 'missing_test':
      return `Add tests for ${base}`;
    case 'missing_doc':
      return `Document exported symbols in ${base}`;
    case 'missing_convention':
      return `Align ${base} with project conventions`;
  }
}

/**
 * Complexity estimate for each gap category.
 *
 * These are advisory estimates fed into the onboarding tour card.
 * They are deterministic and deliberately conservative so a new contributor
 * is not discouraged.
 *
 *   missing_test      — medium: requires understanding the module under test.
 *   missing_doc       — low:    reading + writing TSDoc is straightforward.
 *   missing_convention — low:   mechanical alignment to the stated convention.
 */
function complexityFor(gapType: GapType): string {
  switch (gapType) {
    case 'missing_test':
      return 'medium';
    case 'missing_doc':
      return 'low';
    case 'missing_convention':
      return 'low';
  }
}

// ---- Gap → FirstTaskEntry mapping -------------------------------------

/**
 * Converts a single detected Gap into a FirstTaskEntry.
 *
 * Field mapping:
 *   Gap.gapType        → FirstTaskEntry.gapType
 *   Gap.path           → FirstTaskEntry.suggestedPath
 *   Gap.evidence       → FirstTaskEntry.rationale  (grounded, factual)
 *   Gap.patternPointer → FirstTaskEntry.patternPointer
 *   (derived)          → FirstTaskEntry.title
 *   (derived)          → FirstTaskEntry.complexity
 */
function gapToTask(gap: Gap): FirstTaskEntry {
  return {
    title: titleFor(gap.gapType, gap.path),
    suggestedPath: gap.path,
    gapType: gap.gapType,
    rationale: gap.evidence,
    patternPointer: gap.patternPointer,
    complexity: complexityFor(gap.gapType),
  };
}

// ---- Public API -------------------------------------------------------

/**
 * Build the First-tasks section from detected gaps.
 *
 * @param gaps - Detected gaps from detectGaps() in gaps.ts.
 *               An empty array produces the `omitted` branch — no task is
 *               ever fabricated. The caller must NOT pass synthetic or
 *               placeholder gaps.
 * @returns FirstTasksResult — either `{ kind: 'tasks', tasks }` (1..3 entries)
 *          or `{ kind: 'omitted', reason }` when the gap list is empty.
 *
 * @example
 *   // No gaps found → honest omission
 *   buildFirstTasks([])
 *   // → { kind: 'omitted', reason: 'No gaps detected …' }
 *
 *   // Gaps found → formatted tasks
 *   buildFirstTasks([gap1, gap2])
 *   // → { kind: 'tasks', tasks: [task1, task2] }
 */
export function buildFirstTasks(gaps: Gap[]): FirstTasksResult {
  if (gaps.length === 0) {
    return {
      kind: 'omitted',
      reason:
        'No actionable gaps were detected in the top-ranked files. ' +
        'The codebase appears to have adequate test coverage, documentation, ' +
        'and convention alignment for the files analysed.',
    };
  }

  // Cap to MAX_TASKS; the gap list is already ordered by detectGaps()
  // (missing_test → missing_doc → missing_convention) so the most
  // impactful categories appear first.
  const tasks = gaps.slice(0, MAX_TASKS).map(gapToTask);

  return { kind: 'tasks', tasks };
}
