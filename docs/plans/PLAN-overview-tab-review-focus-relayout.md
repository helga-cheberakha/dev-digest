# Implementation Plan: Overview tab — standalone Review Focus + Intent/Blast card re-layout

## Overview
Restyle the PR detail **Overview tab** (`client/` only) to match the target mockup: render
**Intent** and **Blast Radius** as two equal, side-by-side bordered cards, and lift the
**Review Focus — Read These First** list out of the PR Brief card into its own full-width
bordered card at the very bottom of the tab, restyled as a flat one-row-per-item list. No
contract, server, or `@devdigest/shared` change — `brief.review_focus` (`{label, file_refs}[]`)
is already fetched in `OverviewTab` via the deduped `["brief", prId]` query.

## Execution mode
**multi-agent (parallel)** — the interactive question tool was unavailable in this subagent
session, so this defaults to multi-agent, which matches the parallel structure the request
described (new Review Focus section built alongside Blast Radius theming). The plan uses
non-overlapping Owned paths and an explicit DAG. **If the orchestrator prefers single-agent**,
run the tasks in the linear order T1 → T2 → T3 → T4 → T5; nothing else changes.

## Requirements (verified)
No spec exists for this change (single-module UI, no cross-boundary contract) — the request is
the requirements source. Restated as checkable items:

- **R1** — A standalone "Review Focus — Read These First" section renders at the **bottom** of the
  Overview tab, as its own full-width bordered card, no longer nested inside PrBriefCard.
- **R2** — The Review Focus card header uses the `SectionLabel` style with a **count badge** in the
  `right` slot; each row is a single flat line: bullet/chevron + monospace clickable `path:line`
  + em dash + plain one-line label. **No per-item border box, no severity colour** on these rows.
- **R3** — Clicking a Review Focus `file_ref` calls `onOpenFile` with the parsed `{path, line?}`
  target (behaviour preserved from the old nested rows).
- **R4** — Intent and Blast Radius render as **two side-by-side, equal-width bordered cards**,
  responsive (stack to one column on narrow viewports). `BlastRadiusSection`'s root gains the same
  card treatment `IntentCard` already has (`var(--bg-elevated)` bg + `var(--border)` border +
  radius 8 + padding). `IntentCard` already looks like a card — no visual change to it.
- **R5** — Overview tab layout order becomes: PR Brief banner (full width) → optional Description
  (full width) → 2-column Intent/Blast grid → Review Focus card (full width, bottom).
- **R6** — Behaviour and copy of Review Focus are unchanged (reuse `prBrief` i18n namespace keys
  `reviewFocus`/`reviewFocusEmpty`); the file-ref cap (`MAX_FILE_REFS = 6`) is preserved.
- **R7** — Existing tests stay green: `PrBriefCard.test.tsx` loses its Review Focus assertions;
  equivalent assertions move to a new `ReviewFocusSection.test.tsx`.
- **R8** — Fold in the in-scope cleanups: extract the duplicated `parseFileRef` to a shared util;
  move `MAX_FILE_REFS` next to the new component; drop `PrBriefCard`'s now-dead `onOpenFile` prop
  and internal `parseFileRef` copy.

## Open questions & recommendations
- **Q1 (layout — flagged, not blocking):** Remove the redundant outer `<SectionLabel icon="FileText">
  PR Brief</SectionLabel>` wrapper around `<PrBriefCard>` in `OverviewTab.tsx:34-37`?
  → **Default: remove it.** `PrBriefCard` renders its own visual "PR BRIEF" banner internally, and
  the mockup shows that banner as the top element with no generic section header above it. The
  second header is redundant. Handled in **T5**; flip the default there if the user disagrees.
- **Q2 (layout — flagged, not blocking):** Where does the optional Description section
  (`OverviewTab.tsx:38-42`, only rendered when `prBody` is present) sit in the new layout? It has
  no mockup equivalent. → **Default: full-width, between the PR Brief banner and the Intent/Blast
  grid.** Handled in **T5**; alternative is to keep it directly above Review Focus at the bottom.
- **Rec 1:** Keep `FileRefTarget` and `parseFileRef` co-located in the new `src/lib/parseFileRef.ts`
  as the single source; `OverviewTab.tsx` currently declares its *own* local `FileRefTarget`
  (line 13) — optionally point it at the shared type in T5 to kill the third copy, but this is not
  required for correctness (structurally identical) and is marked optional.
- **Rec 2:** `@testing-library/user-event` is **not** a client dependency — the new test must use
  `fireEvent` (see T3 gotchas). Do not add user-event just for this change.

## Affected modules & contracts
- **client** (`@devdigest/web`) — Overview tab components, PrBriefCard, IntentCard, a new shared
  util, and two test files.
- **Contracts:** none. `brief.review_focus` (`ReviewFocusItem = {label, file_refs: string[]}`,
  `client/src/vendor/shared/contracts/brief.ts:115-128`) is reused as-is. Do **not** edit the
  vendored contract.

## Architecture changes
- **New shared util:** `client/src/lib/parseFileRef.ts` — exports `parseFileRef(ref: string):
  FileRefTarget` and the `FileRefTarget` type. This is the correct home per `frontend-architecture`
  (a second consumer now exists, so promote to shared `lib/`). Consumers: `IntentCard`, the new
  `ReviewFocusSection` (and optionally `OverviewTab`).
- **New component:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/
  ReviewFocusSection.tsx` — colocated in the OverviewTab feature folder next to `BlastRadiusSection`
  (its data comes from the brief `OverviewTab` already holds; it is Overview-tab-specific, not a
  shared component). Client component only if it needs interactivity — it renders clickable rows
  via an `onOpenFile` callback prop passed down from `OverviewTab`, so it stays a presentational
  component with no `"use client"` of its own (the tab tree is already client via `OverviewTab`).
- **Layout:** `OverviewTab.tsx` gains a 2-column CSS-grid wrapper (grid styles added to the
  colocated `OverviewTab/styles.ts`) around `IntentCard` + `BlastRadiusSection`, responsive to one
  column on narrow viewports.

## Phased tasks
<!-- multi-agent: orchestrator spawns `implementer-ui` for every task (all Type: ui). -->

### Phase 1 — Foundation (T1, T2 run concurrently)

- **T1 — Extract `parseFileRef` to a shared util; migrate IntentCard**
  - **Action:**
    1. Create `client/src/lib/parseFileRef.ts` exporting the `FileRefTarget` type (`{ path: string;
       line?: number }`) and `parseFileRef(ref)` — port the exact logic currently in
       `IntentCard.tsx:37` (handles `"path"`, `"path:line"`, `"path:start-end"`).
    2. In `IntentCard.tsx`, delete the local `parseFileRef` (line 37) and the local `FileRefTarget`
       (line 10); import both from `@/lib/parseFileRef`. Re-export `FileRefTarget` from IntentCard
       only if needed for back-compat — grep confirms **no external importer of it exists**, so a
       plain import is sufficient.
    3. Update the two `onOpenFile?: (ref: FileRefTarget) => void` references in IntentCard
       (line 101 and any prop type) to use the imported type.
  - **Module:** client
  - **Type:** ui
  - **Skills to use:** `frontend-architecture`, `typescript-expert`
  - **Owned paths:** `client/src/lib/parseFileRef.ts`, `client/src/components/IntentCard/IntentCard.tsx`
  - **Depends-on:** none
  - **Covers:** n/a (R8)
  - **Risk:** low
  - **Known gotchas:** `IntentCard.tsx:10` currently `export`s `FileRefTarget`; grep across `src/`
    found no consumer importing it from IntentCard, so moving the canonical definition is safe.
  - **Acceptance:** `cd client && npm run typecheck` passes; `npx vitest run src/components/IntentCard`
    stays green; `grep -rn "function parseFileRef" client/src/components/IntentCard` returns nothing
    (local copy removed).

- **T2 — Give BlastRadiusSection the IntentCard card treatment**
  - **Action:**
    1. In `BlastRadiusSection.tsx`, wrap the section root (currently a bare `<section>` at ~line 50)
       so it renders as a bordered card matching `IntentCard`'s `s.card`: `border: 1px solid
       var(--border)`, `borderRadius: 8`, `background: var(--bg-elevated)`, `padding: 18`. Define
       this as a local style object in the file (BlastRadiusSection styles are already inline in the
       component — keep that convention; do **not** reach into IntentCard's styles file).
    2. Do not change the internal content (SectionLabel + Tree/Graph toggle + stat row + tree +
       PriorPrsAccordion) — only the root wrapper's visual treatment.
  - **Module:** client
  - **Type:** ui
  - **Skills to use:** `frontend-architecture`, `react-best-practices`
  - **Owned paths:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusSection.tsx`
  - **Depends-on:** none
  - **Covers:** n/a (R4)
  - **Risk:** low
  - **Known gotchas:** `BlastRadiusSection.test.tsx` exists and must stay green — it asserts on text
    content, not on the wrapper, so a style-only change should not touch it; run it to confirm.
    jsdom in this repo has no `ResizeObserver`/`IntersectionObserver` global — not relevant here
    (no observer added), but do not introduce one.
  - **Acceptance:** BlastRadiusSection root uses the same `var(--bg-elevated)` bg + `var(--border)`
    border + `borderRadius: 8` + `padding: 18` as `IntentCard`'s `s.card`
    (`client/src/components/IntentCard/styles.ts:5`); `npx vitest run
    src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/BlastRadiusSection.test.tsx`
    passes; `npm run typecheck` passes.

### Phase 2 — New section + PrBriefCard slimming (T3, T4 run concurrently)

- **T3 — New standalone ReviewFocusSection component + tests**
  - **Action:**
    1. Create `.../OverviewTab/ReviewFocusSection.tsx`. Props: `items: ReviewFocusItem[]` (or
       `Brief["review_focus"]`) and `onOpenFile?: (ref: FileRefTarget) => void`. Import
       `parseFileRef`/`FileRefTarget` from `@/lib/parseFileRef`.
    2. Render one outer bordered card (same card tokens as IntentCard's `s.card`). Header via
       `SectionLabel` with the item **count in the `right` slot** as a badge; use the `prBrief`
       i18n namespace key `reviewFocus` for the title (`useTranslations("prBrief")`).
    3. Render a flat list: each item is **one row** — a small bullet/chevron, then each `file_ref`
       (capped at `MAX_FILE_REFS = 6`, defined locally in this file — do **not** import it from
       PrBriefCard/constants) as an inline monospace clickable button calling
       `onOpenFile?.(parseFileRef(ref))`, then an em dash, then the plain-text `label`. No per-item
       border box, no severity colouring.
    4. Empty state: when `items` is empty, render the `reviewFocusEmpty` translated message.
    5. Create `ReviewFocusSection.test.tsx` following the sibling `BlastRadiusSection.test.tsx`
       structure/mocking conventions. Cover: (a) count badge renders; (b) each row renders correct
       `file_ref` + `label` text; (c) clicking a `file_ref` calls `onOpenFile` with the correct
       `{path, line?}` — port the m2 cases: `"src/mw/ratelimit.ts:12-20"` → `{path:"src/mw/
       ratelimit.ts", line:12}` and `"src/api/public.ts"` → `{path:"src/api/public.ts"}`;
       (d) empty-state message.
  - **Module:** client
  - **Type:** ui
  - **Skills to use:** `react-best-practices`, `react-testing-library`, `frontend-architecture`, `typescript-expert`
  - **Owned paths:**
    `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/ReviewFocusSection.tsx`,
    `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/ReviewFocusSection.test.tsx`
  - **Depends-on:** T1
  - **Covers:** n/a (R1, R2, R3, R6)
  - **Risk:** medium
  - **Known gotchas:** **`@testing-library/user-event` is NOT installed in client** — use
    `fireEvent` from `@testing-library/react` for the click assertion (established pattern in
    `BlastRadiusSection.test.tsx`); `userEvent.setup()` fails at import. `SectionLabel`'s icon colour
    is hardcoded to `var(--text-muted)` and not overridable via props — fine, the Review Focus icon
    is not severity-coloured. i18n keys `reviewFocus`/`reviewFocusEmpty` live under the `prBrief`
    namespace (`client/messages/en/prBrief.json:16-17`) — reuse that namespace, no new namespace.
  - **Acceptance:** `npx vitest run .../OverviewTab/ReviewFocusSection.test.tsx` passes covering
    empty state + click-to-navigate for both a bare-path and a line-range `file_ref`; the count
    badge renders in the `SectionLabel` `right` slot; `npm run typecheck` passes.

- **T4 — Remove Review Focus from PrBriefCard; fix PrBriefCard test**
  - **Action:**
    1. In `PrBriefCard.tsx`, delete the private `ReviewFocusSection` and `ReviewFocusItemRow`
       functions (~lines 139-196) and their render site (line 246).
    2. Delete the now-unused local `parseFileRef` (line 34) and local `FileRefTarget` (line 22);
       remove the `MAX_FILE_REFS` import (line 18). For the retained `onOpenFile` prop type, import
       `FileRefTarget` from `@/lib/parseFileRef`.
    3. **Keep** the `onOpenFile` prop declared on `PrBriefCardProps` for now but stop destructuring/
       using it internally (leave it accepted-but-ignored) so `OverviewTab.tsx`'s existing
       `<PrBriefCard onOpenFile=...>` call site keeps compiling — its full removal happens in T5,
       which owns the call site. (Rationale: removing the prop here would break OverviewTab's
       compile, which T4 does not own.)
    4. In `PrBriefCard/constants.ts`, remove `MAX_FILE_REFS` (line 23) — it moves into
       ReviewFocusSection (T3).
    5. In `PrBriefCard/styles.ts`, remove the now-unused `focusSection`/`focusList`/`focusItem`/
       `focusLabel`/`focusFileRefs`/`focusFileRefBtn` keys (lines 74-86+).
    6. In `PrBriefCard.test.tsx`, strip the Review Focus assertions from the ~line 160 test (the
       `getByText("src/mw/ratelimit.ts:12-20")` / `getByText("src/api/public.ts")` clicks and the
       `onOpenFile` expectations, ~lines 189-194). Keep only the AC-10 banner + AC-11 metrics
       assertions. Update the test title to drop the `m2` reference.
  - **Module:** client
  - **Type:** ui
  - **Skills to use:** `react-best-practices`, `react-testing-library`, `typescript-expert`
  - **Owned paths:**
    `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx`,
    `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/constants.ts`,
    `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/styles.ts`,
    `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.test.tsx`
  - **Depends-on:** T1
  - **Covers:** n/a (R7, R8)
  - **Risk:** medium
  - **Known gotchas:** `PrBriefCard.tsx:18` imports `RISK_LEVEL_META, METRIC_ICONS, MAX_FILE_REFS`
    from `./constants` — keep the first two, drop only `MAX_FILE_REFS`. Leaving `onOpenFile`
    declared-but-unused as a *prop* (not destructured) does not trip `noUnusedLocals`; do not
    destructure it. Same `user-event`-absent constraint applies to the test edit.
  - **Acceptance:** `npx vitest run .../PrBriefCard/PrBriefCard.test.tsx` passes with **zero Review
    Focus assertions remaining** (`grep -n "ratelimit.ts\|public.ts\|review_focus" .../PrBriefCard.test.tsx`
    returns nothing in assertion context); `npm run typecheck` passes; `grep -n "ReviewFocus\|
    parseFileRef\|MAX_FILE_REFS" .../PrBriefCard.tsx` returns nothing.

### Phase 3 — Layout integration

- **T5 — Re-lay out the Overview tab (grid + bottom Review Focus) and finish the prop cleanup**
  - **Action:**
    1. In `OverviewTab/styles.ts`, add a responsive 2-column grid style (e.g. `display: grid;
       gridTemplateColumns: repeat(2, minmax(0, 1fr)); gap: 16` that collapses to one column on
       narrow viewports — use the project's existing responsive approach; a container-driven or
       `@media`-equivalent inline pattern consistent with the codebase).
    2. In `OverviewTab.tsx`, restructure the render tree to: **PR Brief banner** (`<PrBriefCard>`,
       full width) → **optional Description** (full width, `prBody &&`) → **2-column grid** wrapping
       `<IntentCard>` and `<BlastRadiusSection>` → **`<ReviewFocusSection items={brief?.review_focus
       ?? []} onOpenFile={onOpenFile} />`** (full width, bottom).
    3. **Q1 default — remove** the redundant `<section><SectionLabel icon="FileText">PR Brief
       </SectionLabel>...</section>` wrapper (lines 34-37); render `<PrBriefCard>` directly (its own
       banner is the section header).
    4. **Q2 default — place Description** full-width between the PR Brief banner and the grid.
    5. Finish the `onOpenFile` cleanup: remove the now-genuinely-unused `onOpenFile` prop from
       `PrBriefCard` (`PrBriefCardProps` + the JSDoc that references "Review Focus list ... AC-14")
       and drop it from the `<PrBriefCard>` call site here. This one-line `PrBriefCard.tsx` edit is
       sequenced strictly after T4 (T5 Depends-on T4), so the shared file is never edited
       concurrently.
    6. Optionally point `OverviewTab.tsx`'s local `FileRefTarget` (line 13) at `@/lib/parseFileRef`
       (Rec 1) — optional, not required for green.
  - **Module:** client
  - **Type:** ui
  - **Skills to use:** `frontend-architecture`, `react-best-practices`, `next-best-practices`, `typescript-expert`
  - **Owned paths:**
    `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`,
    `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/styles.ts`,
    `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx` (prop-removal slice only — sequential after T4)
  - **Depends-on:** T2, T3, T4
  - **Covers:** n/a (R1, R4, R5)
  - **Risk:** medium
  - **Known gotchas:** `OverviewTab.tsx` keeps its own local `FileRefTarget` (line 13) — it does
    **not** import it from PrBriefCard, so T4's PrBriefCard changes cannot break OverviewTab's type;
    the only OverviewTab breakage risk is the `onOpenFile` prop on `<PrBriefCard>`, which this task
    resolves in step 5. `IntentCard`'s `s.card` has `marginBottom: 16` — inside a grid, prefer the
    grid `gap` for spacing and verify the two cards align at the top (uneven card heights are
    expected and fine).
  - **Acceptance:** Overview tab renders in the order PR Brief banner → optional Description →
    2-column Intent/Blast grid → full-width Review Focus card; Intent and Blast Radius sit
    side-by-side at equal width and stack to one column on a narrow viewport; the redundant "PR
    Brief" `SectionLabel` wrapper is gone; `npm run typecheck` passes and the full client suite
    `npm test` is green; `grep -n "onOpenFile" .../PrBriefCard/PrBriefCard.tsx` returns nothing.

## Testing strategy
- **Unit / component (vitest + RTL):**
  - New: `cd client && npx vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/ReviewFocusSection.test.tsx`
    — count badge, per-row text, click-to-navigate (bare path + line range), empty state. Use
    `fireEvent` (no `user-event` in client).
  - Regression: `cd client && npx vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/PrBriefCard/PrBriefCard.test.tsx`
    — passes with Review Focus assertions removed.
  - Regression: `cd client && npx vitest run src/app/repos/\[repoId\]/pulls/\[number\]/_components/OverviewTab/BlastRadiusSection.test.tsx`
    and `npx vitest run src/components/IntentCard` — style/import refactors do not break them.
- **Typecheck:** `cd client && npm run typecheck` (`tsc --noEmit`) after every task.
- **Full gate (after T5):** `cd client && npm test` — whole client suite green.
- **Visual (manual):** load PR #482 Overview tab dark theme; confirm the mockup layout.

## Risks & mitigations
- **Shared file `PrBriefCard.tsx` across T4 and T5** → mitigated by the strict `T5 Depends-on T4`
  edge: they are never concurrent, and T5's edit is a one-line prop removal. Compliant with the
  non-overlap rule ("if they must touch the same file, make one Depends-on the other").
- **Broken intermediate compile from prop removal** → mitigated by T4 keeping `onOpenFile` as an
  accepted-but-ignored prop; only T5 (which owns the OverviewTab call site) removes it.
- **Out of scope (record only, do not implement):** `OverviewTab.tsx`'s third local `FileRefTarget`
  copy (line 13) — collapsing it into the shared util is optional (Rec 1); leaving it is harmless.
- **Responsive grid approach** → confirm the codebase's existing responsive pattern before adding a
  media query; if none exists inline, a CSS-grid `auto-fit`/`minmax` fallback keeps it dependency-free.

## Red-flags check
- [x] Every requirement maps to a task (R1-R3,R6 → T3; R4 → T2; R5 → T5; R7 → T3+T4; R8 → T1+T4+T5)
- [x] (no spec exists) — n/a for AC coverage; requirements are R-items above
- [x] No specification was authored or edited — requirements taken as input
- [x] Execution mode recorded (multi-agent; single-agent fallback order given)
- [x] Dependencies form a DAG: T1←(T3,T4); (T2,T3,T4)←T5; no cycles
- [x] (multi-agent) Concurrent tasks have non-overlapping Owned paths: {T1,T2} disjoint;
      {T3,T4} disjoint; T5 alone in Phase 3 (its shared `PrBriefCard.tsx` is sequential via Depends-on T4)
- [x] Every Acceptance is measurable (test path, grep result, or typecheck command)
- [x] No edits to existing shared contracts — `brief.ts` reused read-only
- [x] No AC prose restated from a spec (none exists)
- [x] No task Action has 10+ numbered steps; no sub-5-minute sibling tasks left unmerged
- [x] Cross-cutting Owned paths grep-verified with file:line (parseFileRef defs, MAX_FILE_REFS,
      focus styles, onOpenFile call site, FileRefTarget sources all cited from grep output)
- [x] No deleted/narrowed `@devdigest/shared` symbol — nothing to sweep across packages
- [x] New file `ReviewFocusSection.tsx` is imported explicitly by `OverviewTab.tsx` (T5); its test
      `ReviewFocusSection.test.tsx` matches the vitest include glob `src/**/*.test.tsx` (verified in
      `client/vitest`/`package.json` test script `vitest run`)
