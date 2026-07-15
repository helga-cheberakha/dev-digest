# Insights — e2e

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

- **2026-07-15** — `agent-browser`'s `wait --text "…"` and CSS `text=…` selectors match against the post-CSS-transform RENDERED text, case-sensitively — a `<h2>` styled with `text-transform: uppercase` (the design system's standard section-label convention, e.g. `RECENT REVIEWS`) fails a mixed-case `wait --text "Recent reviews"` even though the DOM/i18n source string is mixed-case. Separately, `click "text=…"` and XPath `contains(., '…')` don't reliably match a multi-span clickable row (icon + title span + meta span) even when the full concatenated text is correct. Fix for both: `agent-browser snapshot -i` to get an accessible-name-based `@eN` ref (accessible name concatenates child text correctly and is case-insensitive to CSS), then `click @eN` / assert against the snapshot's printed text instead of `wait --text`. Evidence: manual verification of `client/src/app/multi-agent/configure/_components/ConfigureRunView/ConfigureRunView.tsx`'s "Recent reviews" list.

## Codebase Patterns

- **2026-07-07** — `run.ts` `loadFlows()` discovers ONLY files matching `*.flow.json` in `e2e/specs/` (existing convention: `NN-name.flow.json`). A spec file named without the `.flow.json` suffix is silently never executed — the runner still reports "N/N flows passed" with no error. When adding a flow, match the glob and the `NN-` numbering, and eyeball the runner's flow count once. Evidence: `e2e/run.ts` (`loadFlows`), `e2e/specs/08-brief-review-focus-click.flow.json`.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
