# Insights — client

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-06-18** — `@devdigest/shared` is vendored separately into both `server/src/vendor/shared/` and `client/src/vendor/shared/` — changes to shared contracts (Zod schemas) must be applied in both copies, or only one package will type-check. Evidence: `client/src/vendor/shared/contracts/trace.ts`, `server/src/vendor/shared/contracts/trace.ts`.

## Tool & Library Notes

## Recurring Errors & Fixes

- **2026-06-18** — Adding a field to `RunSummary` only in the server vendor copy caused the client build to fail with "Property does not exist" — the client has its own `src/vendor/shared/` with identical files that must be updated independently.

## Session Notes

## Open Questions
