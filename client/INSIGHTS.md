# Insights — client

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

- **2026-06-18** — `position: absolute` popups inside a container with `overflow: hidden` are silently clipped — `tableCard` in `client/src/app/repos/[repoId]/pulls/styles.ts` sets `overflow: hidden` for border-radius; any popup child that extends beyond the row is cut off. Fix: `position: fixed` anchored via `ref.current.getBoundingClientRect()` on the trigger so the popup escapes all ancestor clipping. Evidence: `client/src/components/FindingsPopup/FindingsPopup.tsx`.

- **2026-06-18** — Hover-triggered popups (`onMouseEnter`/`onMouseLeave`) can't be scrolled or focused — moving the cursor into the popup fires `mouseLeave` on the trigger, closing the popup before the user interacts. Fix: click-to-open with `document.addEventListener("mousedown", handler)` for click-outside dismiss plus an Escape `keydown` listener. Evidence: `client/src/components/FindingsPopup/FindingsPopup.tsx`, `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx`.

## Codebase Patterns

- **2026-06-18** — Lazy React Query fetch via `enabled`: pass `enabled: !!open` to `useQuery` to defer a network call until user action (e.g., opening a popup). The query stays idle until the condition turns truthy, avoiding unnecessary requests on mount. Evidence: `FindingsCell` in `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx`.

- **2026-06-18** — `@devdigest/shared` is vendored separately into both `server/src/vendor/shared/` and `client/src/vendor/shared/` — changes to shared contracts (Zod schemas) must be applied in both copies, or only one package will type-check. Evidence: `client/src/vendor/shared/contracts/trace.ts`, `server/src/vendor/shared/contracts/trace.ts`.

## Tool & Library Notes

## Recurring Errors & Fixes

- **2026-06-18** — Adding a field to `RunSummary` only in the server vendor copy caused the client build to fail with "Property does not exist" — the client has its own `src/vendor/shared/` with identical files that must be updated independently.

## Session Notes

### 2026-06-18

Findings column feature: added `findings_counts` to `PrMeta` (both vendor copies), new `FindingsBadge` and `FindingsPopup` components, findings aggregation in the PR list server route, Findings column in the PR list table with click-to-open popup (lazy-loaded via `usePrReviews`), and per-run severity badge + popup in `RunHistory` (linked via `run_id` to `ReviewRecord`).

## Open Questions
