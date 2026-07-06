# Insights — client

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

- **2026-06-14** — `formatCost` (`src/lib/cost.ts`) distinguishes MISSING data (`null`/`undefined` → "—") from a genuine zero (`0` → "$0.00"), widens precision for sub-cent values (~2 sig figs), and trims trailing zeros to a 2dp floor ("$0.06" not "$0.060", "$0.0013" not "$0.00"). Reuse it for any per-run money display.

## What Doesn't Work

- **2026-07-06** — The reference-build `BlastGraph` (Blast tab Graph toggle) graphed ONLY `blast.downstream[0]` and rendered the "nothing to graph" empty state whenever that first entry had 0 callers — even when later symbols had callers/endpoints (PR #7: `downstream[0]` = CodeLine with 0/0, while executeRuns/ReviewRunExecutor each had a caller). Fixed by deriving per-symbol nodes/edges over ALL downstream entries (same attribution as `BlastGraphLightbox`), skipping symbols with nothing downstream; empty state now requires zero edges total. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadius/BlastRadius.tsx:96`.
- **2026-06-30** — `reviews.ts` does NOT re-export `usePrIntent` or `useSmartDiff` by default — those hooks live in `intent.ts` and `smartDiff.ts` respectively. `page.tsx` imports both from `reviews.ts` and silently fails at runtime if not bridged. Fix: add `export { usePrIntent, useClassifyIntent } from './intent.js'` and `export { useSmartDiff } from './smartDiff.js'` to `reviews.ts`. Evidence: `client/src/lib/hooks/reviews.ts`.
- **2026-06-30** — Two SmartDiffViewer implementations exist simultaneously: the reference version at `_components/SmartDiffViewer/` (props: `smartDiff, files, commenting?`) and the enhanced version at `src/components/SmartDiffViewer/` (props: `smartDiff, allFindings, files?, onNavigateToFinding`). `DiffTab` must import from `@/components/SmartDiffViewer` (the enhanced one); using the relative `../SmartDiffViewer` path would silently miss the enhanced API or fail if `_components/SmartDiffViewer/` is absent. Evidence: `_components/DiffTab/DiffTab.tsx`.
- **2026-06-30** — `PrBrief.intent` schema diverged from the reference build: current codebase uses `summary: string`; the reference uses `intent: string`. Copying `PrBriefCard` from the reference causes a TS error at `intent.intent` — replace with `intent.summary`. The mismatch also breaks test fixtures. Evidence: `_components/PrBriefCard/PrBriefCard.tsx:42`, `client/src/vendor/shared/contracts/brief.ts:10`.
- **2026-06-17** — The PR-list `tableCard` has `overflow: "hidden"` (`pulls/styles.ts`) which CLIPS absolutely-positioned hover popovers (`FindingsHoverCard`) opening downward from the bottom rows; upper rows render fine (matching the design). `FindingsHoverCard` is dependency-free (anchor wrapper + `position:absolute` panel) — to fully escape the card it would need a portal + `position:fixed` from the anchor's `getBoundingClientRect`. Deferred; not needed for the common case. Evidence: `client/src/components/FindingsHoverCard/`, `pulls/styles.ts:97`.

## Codebase Patterns

- **2026-06-25** — `DiffTab`'s smart/original toggle uses a `useRef` flag (`defaultedRef.current`) to flip the view to `"smart"` exactly once when `smartDiff` data first arrives, without re-flipping if the user switches back to original. A plain `useEffect([smartDiff])` without the ref would re-apply the default on every remount or data refresh. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`.
- **2026-06-25** — `navigateToFinding(findingId)` in `page.tsx` sets BOTH `tab=findings` AND `finding=<id>` in a single `router.replace` to avoid double navigation that calling `setParam` twice would cause. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`.

- **2026-06-17** — `FindingsHoverCard` renders its panel in a `createPortal(document.body)` with `position:fixed` (coords measured from the anchor's `getBoundingClientRect` on open, recomputed on resize, closed on scroll). This is the fix for the earlier `overflow:hidden` clipping limitation — the panel escapes any clipping ancestor. Because the panel is outside the anchor's subtree, BOTH the anchor and the portal panel carry the open/close mouse handlers (shared 120ms timer) so the pointer can cross the gap. Evidence: `client/src/components/FindingsHoverCard/FindingsHoverCard.tsx`.
- **2026-06-17** — Finding deep-linking: a findings popover navigates to `…/pulls/:number?tab=findings&finding=:id`. The PR-detail page reads `?finding`, forces the findings tab, and threads `focusFindingId` → `FindingsTab` (resolves finding→run, reuses the `targetRunId` open+scroll) → `ReviewRunAccordion` (opens if it owns the finding) → `FindingsPanel` (scrolls to `[data-finding-id]` + `defaultExpanded`). A finding's file:line link opens the PR's Files tab (`githubPrFilesUrl`), not the standalone blob. Evidence: `pulls/[number]/page.tsx`, `FindingsTab`, `ReviewRunAccordion`, `FindingsPanel`.

- **2026-06-18** — `BarChart2` and `GripVertical` do NOT exist in the `@devdigest/ui` icon registry. Use `BarChart` for charts and a unicode character (e.g. `⠿`) for drag handles. Always verify icon names against `client/src/vendor/ui/icons.tsx` before using them — a wrong name silently renders nothing because Icon is a proxy object.
- **2026-06-18** — The `AgentEditor` tab system has TWO places to update: `TABS` constant in `AgentEditor/constants.ts` (controls the tab bar) and `VALID_TABS` array in `agents/[id]/page.tsx` (validates the `?tab=` URL param). Both must be kept in sync when adding a tab — missing VALID_TABS causes the new tab to silently redirect to `config`. Evidence: `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `client/src/app/agents/[id]/page.tsx:15`.

- **2026-06-14** — Cross-route shared components live in `src/components/<Name>/` with an `index.ts` barrel, imported via `@/components/<Name>` (e.g. `RunCostBadge`, `diff-viewer`). Vendored UI primitives (`Badge`, `CircularScore`) live in `src/vendor/ui` under `@devdigest/ui` — different home. Evidence: `client/src/components/RunCostBadge/`.
- **2026-06-14** — The PR-list table is driven by two parallel constants that MUST stay length-aligned: `COLUMN_KEYS` (header keys + order) and `GRID` (CSS grid-template tracks). Adding a column = add to both AND render a matching cell in `PRRow.tsx`, else header/cells misalign silently. Evidence: `client/src/app/repos/[repoId]/pulls/constants.ts`.
- **2026-06-14** — i18n has only the `en` locale (`client/messages/en/`); new UI strings need a key under the right namespace file (e.g. `prReview.json`, `runs.json`) read via `useTranslations("<ns>")`. A missing key renders the raw key, not an error.

- **2026-07-06** — The `BlastRadius/` barrel (`index.ts`) re-exports ONLY `BlastRadiusView`. `blastCounts` and `STAT_ICONS` must be imported directly from `../BlastRadius/helpers.js` / `../BlastRadius/constants.js` — importing them from `../BlastRadius` compiles a missing-export error. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadius/index.ts`.

- **2026-06-30** — `CodeLine` was a private unexported function inside `DiffViewer.tsx`. To reuse it with per-line finding highlights in SmartDiffViewer, extract it to `diff-viewer/CodeLine/CodeLine.tsx` with two extra props: `rowBackground?: string` (overrides line-kind color) and `rightBadge?: React.ReactNode` (appended after line text). Import via `@/components/diff-viewer/CodeLine`. Evidence: `client/src/components/diff-viewer/CodeLine/CodeLine.tsx`.

## Tool & Library Notes

- **2026-07-06** — `@testing-library/user-event` is NOT in client's package.json — component tests must use `fireEvent` from `@testing-library/react` for clicks/keys (established pattern: `BlastTab.test.tsx`). Don't write `userEvent.setup()` from RTL-skill muscle memory; it fails at import. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusSection.test.tsx`.
- **2026-07-06** — jsdom has no `ResizeObserver` and no global stub exists in the client test setup — any component that instantiates one (e.g. to measure an SVG canvas) crashes its tests unless the test file defines a minimal stub (`class { observe(){} unobserve(){} disconnect(){} }`) on `globalThis` before render. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastGraphLightbox.test.tsx`.
- **2026-06-25** — Design system color tokens (defined in `vendor/ui/styles.css`): green = `--ok` / `--ok-bg`, red = `--crit` / `--crit-bg`, amber/warning = `--warn` / `--warn-bg`. There is NO `--green`, `--red`, or `--amber` — using them silently produces invalid CSS (no color). Spin animation is `ddspin`, not `spin` (`@keyframes ddspin` at line 225). Evidence: `client/src/vendor/ui/styles.css:25-35,225`.

## Recurring Errors & Fixes

- **2026-07-05** — Relative import depth from `pulls/[number]/_components/<Tab>/` to `src/lib/` is SEVEN levels up (`../../../../../../../lib/hooks/brief`), not five — plan docs and intuition routinely undercount because of the `repos/[repoId]/pulls/[number]` nesting. Fix: grep a neighboring component's imports (e.g. `ComposeReviewDrawer`) and copy the depth instead of counting. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastTab/BlastTab.tsx`.

- **2026-06-30** — React warns when `borderColor` (shorthand) and `borderLeftColor` (longhand) appear in the same style object — both affect the same CSS property and React detects the conflict on re-render. Fix: replace `borderColor` with three explicit longhands (`borderTopColor`, `borderRightColor`, `borderBottomColor`) and keep `borderLeftColor` unchanged. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/styles.ts:12-15`.

## Session Notes

### 2026-07-06 (Overview compact summary + focus trap)
- Overview tab reworked: `BlastRadiusSection` no longer renders the full `BlastRadiusView` — replaced with a compact 4-count stat row (`blastCounts` from `../BlastRadius/helpers.js`) plus a "View full Blast Radius" button; navigation threaded as `onGoToBlast: () => void` from `page.tsx` (`setTab("blast")`) → `OverviewTab` → section. `repoFullName`/`headSha` props removed from that chain (served only the removed `BlastRadiusView`); `summary.goToTab` key added to `blast.json`. `BlastTab/` and `BlastRadius/` untouched.
- `BlastGraphLightbox` gained a focus trap: initial focus moves to the close button on mount; Tab/Shift+Tab cycles within the dialog (vanilla `querySelectorAll`, no deps). 69 client tests green.

### 2026-07-06 (Blast Radius v2)
- Added Blast Radius section to the Overview tab (HW04): `OverviewTab/BlastRadiusSection.tsx` (reuses `BlastRadiusView` + `usePrBlast` — same `["blast", prId]` query key as BlastTab, so no extra fetch), `PriorPrsAccordion.tsx` (renders null when empty), `prior_prs` on the `BlastRadius` contract (lockstep vendor edit), `priorPrs.*`/`graph*` keys in `blast.json`, `repoFullName`/`headSha` threaded from `page.tsx` through `OverviewTab`.
- BONUS: `BlastGraphLightbox.tsx` — portal + fixed overlay + ESC-close dialog with a hand-rolled layered SVG graph (symbols/callers/endpoints columns, cubic-bezier edges); edges derived per-`DownstreamImpact` so each symbol links only to its own callers/endpoints (no d3 dependency added). Graph button lives in `SectionLabel`'s `right` prop.
- 65 client tests green (7 new); caller click opens `githubBlobUrl` in a new tab — DiffTab still has no `?file=`/`?line=` deep-linking.

### 2026-07-05 (Blast Radius)
- Built Blast Radius UI (L04): `BlastTab` component (Skeleton/ErrorState/degraded Badge with `--warn` tokens, reuses existing `BlastRadiusView` with `onWhy` repurposed to open `githubBlobUrl` in a new tab), `Zap` tab entry in `PrDetailHeader`, `tab === "blast"` branch in `page.tsx`, `tab.*` i18n keys in `blast.json`. PR detail tabs need only two touch points (header tabs array + page branch) — no VALID_TABS gate, unlike AgentEditor. 58 client tests green (4 new).

### 2026-06-30
- Analyzed reference build vs lesson/04 branch; copied missing `_components` (ComposeReviewDrawer, WhyTimelineDrawer, ConformanceTab, PrBriefCard, BlastRadius, SmartDiffViewer) and missing hooks (brief.ts, compose.ts, conformance.ts).
- Used user's enhanced SmartDiffViewer (`allFindings` + `onNavigateToFinding`) over reference's simpler version; updated DiffTab to import from `@/components/SmartDiffViewer` and pass the new props; page.tsx wired `allFindings` + `onNavigateToFinding` → DiffTab.
- Wired `IntentCard` into `OverviewTab` (component existed but was never rendered). Fixed `PrDetailHeader` to add `onComposeOpen` + Conformance tab. Extracted `CodeLine` from `DiffViewer.tsx` into `diff-viewer/CodeLine/`.
- All 22 client tests + 145 server tests pass; TypeScript clean.

### 2026-06-25 (Smart Diff)
- Built Smart Diff UI (L03): `lib/hooks/smartDiff.ts` (`useSmartDiff`), `components/SmartDiffViewer/` (file-list viewer — NOT a code diff viewer — grouped by core/wiring/boilerplate with finding badges and role accordion), `DiffTab` updated with smart/original toggle, `page.tsx` wired `useSmartDiff` + `navigateToFinding`.

### 2026-06-25
- Built Intent Layer UI (L03): `lib/hooks/intent.ts` (usePrIntent + useClassifyIntent), `components/IntentCard/` (skeleton/empty/filled states, `--ok`/`--crit`/`--warn` color tokens, `ddspin` animation), `OverviewTab` updated to accept `prId` and render IntentCard above PR body.

### 2026-06-18
- Built Skills UI (L02): `lib/hooks/skills.ts`, `/skills` page + SkillsListView + SkillCard + ImportDrawer, `/skills/[id]` + SkillEditor with Config/Preview/Versions/Stats tabs, AgentEditor SkillsTab (HTML5 DnD reorder, checkbox link/unlink), nav SKILLS LAB section, i18n keys.
- Skills tab added to AgentEditor — both `constants.ts` (TABS) and `page.tsx` (VALID_TABS) updated.

## Open Questions
