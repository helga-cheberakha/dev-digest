/** Navigation target derived from a `Risk.file_refs` entry (AC-14). */
export interface FileRefTarget {
  path: string;
  line?: number;
}

/**
 * Parses a `file_ref` (`"path"`, `"path:line"`, or `"path:start-end"`) into a
 * navigable target. A range contributes its start line (m2); a suffix that
 * isn't a recognised line/range falls back to treating the whole ref as a
 * bare path (defensive — grounding already guarantees the path portion is a
 * known file, but the suffix shape isn't validated there).
 */
export function parseFileRef(ref: string): FileRefTarget {
  const idx = ref.lastIndexOf(":");
  if (idx === -1) return { path: ref };
  const path = ref.slice(0, idx);
  const suffix = ref.slice(idx + 1);
  const match = suffix.match(/^(\d+)(?:-\d+)?$/);
  if (!match) return { path: ref };
  return { path, line: Number(match[1]) };
}
