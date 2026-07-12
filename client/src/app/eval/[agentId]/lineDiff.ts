/**
 * highlightAdditions — line-level "what's new" marker for a prompt diff.
 *
 * The Compare modal shows the NEW prompt in full with added lines
 * emphasized, not a full add/remove unified diff — so this only needs to
 * know which lines of `newText` are absent from `oldText`, not compute an
 * edit script.
 */
export interface DiffLine {
  text: string;
  added: boolean;
}

export function highlightAdditions(oldText: string, newText: string): DiffLine[] {
  const oldLines = new Set(oldText.split("\n"));
  return newText.split("\n").map((text) => ({ text, added: !oldLines.has(text) }));
}
