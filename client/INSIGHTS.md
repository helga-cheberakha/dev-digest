# Insights — client

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

- **2026-06-18** — `position: absolute` popups inside a container with `overflow: hidden` are silently clipped — `tableCard` in `client/src/app/repos/[repoId]/pulls/styles.ts` sets `overflow: hidden` for border-radius; any popup child that extends beyond the row is cut off. Fix: `position: fixed` anchored via `ref.current.getBoundingClientRect()` on the trigger so the popup escapes all ancestor clipping. Evidence: `client/src/components/FindingsPopup/FindingsPopup.tsx`.

- **2026-06-18** — Hover-triggered popups (`onMouseEnter`/`onMouseLeave`) can't be scrolled or focused — moving the cursor into the popup fires `mouseLeave` on the trigger, closing the popup before the user interacts. Fix: click-to-open with `document.addEventListener("mousedown", handler)` for click-outside dismiss plus an Escape `keydown` listener. Evidence: `client/src/components/FindingsPopup/FindingsPopup.tsx`, `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx`.

- **2026-06-18** — Click-popup toggle race: when the popup is open, clicking the trigger fires the document `mousedown` listener (→ `onClose`) and then the button `onClick` (→ toggle), so the popup stays open instead of closing. Fix: add `onMouseDown={(e) => e.stopPropagation()}` to the trigger `<button>` so the document listener never sees the click. Evidence: `PRRow.tsx` `FindingsCell`, `RunHistory.tsx` `RunFindingsBadge`.

- **2026-06-18** — `position: fixed` is re-anchored by any ancestor with `transform`, `filter`, or `will-change` (creates a new containing block). If animated/GPU-composited ancestors exist, use `createPortal(…, document.body)` instead. Complements the `overflow: hidden` clipping note above; the two are the main reasons a popup can escape or stay trapped in its container.

- **2026-06-19** — Gating a click-trigger on raw `array.length > 0` when the rollup that drives the badge EXCLUDES dismissed items causes a mismatch: all-dismissed reviews show a clickable "—" badge that opens an empty popup. Always derive `hasFindings` from the rollup result, not from raw length: `const hasFindings = counts !== null && (counts.critical > 0 || counts.warning > 0 || counts.suggestion > 0)`. Evidence: `RunFindingsBadge` in `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:106`.

## Codebase Patterns

- **2026-06-18** — Lazy React Query fetch via `enabled`: pass `enabled: !!open` to `useQuery` to defer a network call until user action (e.g., opening a popup). The query stays idle until the condition turns truthy, avoiding unnecessary requests on mount. Evidence: `FindingsCell` in `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx`.

- **2026-06-18** — Keep the React Query key stable and gate with `enabled`: `usePrReviews(id, { enabled: open })` keeps the key `["reviews", id]` constant so cached data survives popup close/reopen. The previous pattern `usePrReviews(open ? id : undefined)` changed the key to `["reviews", undefined]` on close, forcing a refetch on every reopen under default `staleTime: 0`. Evidence: `PRRow.tsx` `FindingsCell`, `client/src/lib/hooks/reviews.ts`.

- **2026-06-19** — Server findings aggregation returns `null` (not `{critical:0,warning:0,suggestion:0}`) for PRs with zero active findings, because the query WHERE clause includes `isNull(dismissedAt)` — dismissed findings never enter the map. A PR whose only findings are all dismissed gets `findings_counts = null`, so `!pr.findings_counts` in `PRRow` correctly blocks the button. If you ever remove the WHERE filter, the zero-object would flow through and break the null guard. Evidence: `server/src/modules/pulls/routes.ts` findings aggregation block.

- **2026-06-18** — `runs` vs `prRuns` naming in `FindingsTab` is counterintuitively inverted: `runs: ReviewRecord[]` and `prRuns: RunSummary[]`. Not a bug, but a reliable false-positive magnet for both human reviewers and LLM reviewers (prompted the "reviews={runs} type mismatch" false positive). Always read the prop interface before assuming from the name. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx`.

- **2026-06-18** — `@devdigest/shared` is vendored separately into both `server/src/vendor/shared/` and `client/src/vendor/shared/` — changes to shared contracts (Zod schemas) must be applied in both copies, or only one package will type-check. Evidence: `client/src/vendor/shared/contracts/trace.ts`, `server/src/vendor/shared/contracts/trace.ts`.

## Tool & Library Notes

## Recurring Errors & Fixes

- **2026-06-18** — Adding a field to `RunSummary` only in the server vendor copy caused the client build to fail with "Property does not exist" — the client has its own `src/vendor/shared/` with identical files that must be updated independently.

## Session Notes

### 2026-06-18

Findings column feature: added `findings_counts` to `PrMeta` (both vendor copies), new `FindingsBadge` and `FindingsPopup` components, findings aggregation in the PR list server route, Findings column in the PR list table with click-to-open popup (lazy-loaded via `usePrReviews`), and per-run severity badge + popup in `RunHistory` (linked via `run_id` to `ReviewRecord`).

### 2026-06-18 — Reviewer harness experiment

Ran the same `homework/01` diff through (a) base DevDigest agent, (b) bare Claude Code one-liner, and (c) enriched prompt (severity rubric + injected INSIGHTS + file:line rule). Enrichment surfaced the viewport-clip and removed the `.sort()` filler finding, but produced a confident false positive: "reviews={runs} type mismatch" — because `FindingsTabProps` wasn't in the diff and the reviewer inferred the type from the variable name alone. Lessons: (1) confidence ≠ correctness — validating a finding by pulling the type definition is mandatory; (2) the biggest reviewer-quality lever is feeding type/signature context via `repoMap`/`callers` (populated when the repo is indexed), not prompt wording; (3) narrowing focus can drop true positives (the stale-anchor-on-scroll finding was lost between runs); (4) `INJECTION_GUARD` in `reviewer-core/src/prompt.ts` correctly blocks "test fixture / not for production" severity downgrades.

## Open Questions
