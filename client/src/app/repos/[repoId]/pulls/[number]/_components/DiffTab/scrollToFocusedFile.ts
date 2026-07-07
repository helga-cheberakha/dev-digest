/* scrollToFocusedFile — AC-14 "click a file_ref → Files tab, scroll to +
   highlight the file (and the line, when present)".

   Both diff renderers (`@/components/SmartDiffViewer` and
   `@/components/diff-viewer`'s `DiffViewer`) live outside this task's owned
   paths (client/INSIGHTS.md 2026-06-30 — DiffTab only *imports* them) so we
   cannot add a `focusFile` prop to their internals. Instead this walks the
   ALREADY-RENDERED DOM from DiffTab's own container: find the file row by
   its rendered path text, expand it (and its SmartDiffViewer role-group, if
   collapsed) via simulated clicks, scroll into view, and apply a temporary
   outline highlight. Bounded retries via requestAnimationFrame absorb the
   async re-render after each simulated click. AC-14 is E2E-observable only
   (spec), so this DOM-level approach is exercised the same way a real user
   interaction would be. */

export interface FocusFileTarget {
  path: string;
  line?: number;
}

const MAX_ATTEMPTS = 6;
const HIGHLIGHT_MS = 2200;
const ROLE_GROUP_LABELS = ["Core logic", "Wiring", "Boilerplate"];

/** SmartDiffViewer/DiffViewer both render the file's full path inside a
 *  `<span>` (SmartDiffViewer splits it into dir/filename child spans, but
 *  the parent span's trimmed textContent still equals the full path, and
 *  `querySelectorAll` visits it before its children — the first match is
 *  always the row's outer path span). Its direct parent is the clickable
 *  row header in both viewers. */
function findFileRowHeader(container: HTMLElement, path: string): HTMLElement | null {
  const spans = Array.from(container.querySelectorAll<HTMLElement>("span"));
  const match = spans.find((el) => el.textContent?.trim() === path);
  return match?.parentElement ?? null;
}

/** CodeLine (both viewers reuse the same shape) renders the gutter number in
 *  a `.tnum` span; its nearest ancestor `<div>` is the line's row wrapper. */
function findLineElement(diffBody: HTMLElement, line: number): HTMLElement | null {
  const gutters = Array.from(diffBody.querySelectorAll<HTMLElement>(".tnum"));
  const gutter = gutters.find((el) => el.textContent?.trim() === String(line));
  return gutter?.closest("div") ?? null;
}

/** Opens any collapsed SmartDiffViewer role-group (core/wiring default open;
 *  boilerplate defaults closed) so a boilerplate file's row exists in the
 *  DOM at all. No-op against DiffViewer's flat file list (no group headers
 *  to match). */
function expandCollapsedGroups(container: HTMLElement): void {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
  for (const btn of buttons) {
    const text = btn.textContent?.trim() ?? "";
    const isGroupHeader = ROLE_GROUP_LABELS.some((label) => text.startsWith(label));
    if (isGroupHeader && btn.nextElementSibling === null) btn.click();
  }
}

function flashHighlight(el: HTMLElement): void {
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = "2px solid var(--warn, #d97706)";
  el.style.outlineOffset = "-2px";
  el.setAttribute("data-focus-highlight", "true");
  window.setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
    el.removeAttribute("data-focus-highlight");
  }, HIGHLIGHT_MS);
}

/** Scrolls to and highlights `focusFile` inside the rendered diff container.
 *  A missing `line` scrolls to and highlights the file row only (spec edge
 *  case). Safe to call repeatedly (e.g. from a `useEffect`) — expansion
 *  clicks are idempotent once a section is already open. */
export function scrollToFocusedFile(
  container: HTMLElement,
  focusFile: FocusFileTarget,
  attempt = 0,
): void {
  expandCollapsedGroups(container);

  const row = findFileRowHeader(container, focusFile.path);
  if (!row) {
    if (attempt < MAX_ATTEMPTS) {
      requestAnimationFrame(() => scrollToFocusedFile(container, focusFile, attempt + 1));
    }
    return;
  }

  if (focusFile.line == null) {
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    flashHighlight(row);
    return;
  }

  const body = row.nextElementSibling as HTMLElement | null;
  if (!body) {
    // The file's own diff body is collapsed — expand it and retry.
    if (attempt < MAX_ATTEMPTS) {
      row.click();
      requestAnimationFrame(() => scrollToFocusedFile(container, focusFile, attempt + 1));
    }
    return;
  }

  const lineEl = findLineElement(body, focusFile.line);
  if (!lineEl) {
    // Line not found (e.g. not part of the patch) — degrade to file-only highlight.
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    flashHighlight(row);
    return;
  }

  lineEl.scrollIntoView({ behavior: "smooth", block: "center" });
  flashHighlight(lineEl);
  flashHighlight(row);
}
