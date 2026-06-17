---
name: engineering-insights
description: Captures non-obvious engineering insights into the touched module's INSIGHTS.md (client, server, reviewer-core, e2e). Use during a session the moment you hit something a future agent would otherwise relearn — a gotcha, a working approach, a dead-end antipattern, a codebase convention, a tool/library quirk, a recurring error+fix, or an open question — and again at session end, on "wrap up" / "retro", or when /engineering-insights is invoked. Reads the existing file first, never duplicates, writes only substantial file-grounded entries, and is strictly append-only (never overwrites).
---

# Engineering Insights

Capture one durable engineering insight into the **INSIGHTS.md of the module the work touched**, so the next session doesn't relearn it. Read what's already there, add only what's new and substantial, never overwrite.

## Where to write

Identify the primary module from the user's first message and route insights there:

| Module touched             | File                        |
|----------------------------|-----------------------------|
| `client/`                  | `client/INSIGHTS.md`        |
| `server/`                  | `server/INSIGHTS.md`        |
| `reviewer-core/`           | `reviewer-core/INSIGHTS.md` |
| `e2e/`                     | `e2e/INSIGHTS.md`           |
| Cross-cutting / root-level | `INSIGHTS.md` (root)        |

## INSIGHTS.md sections

Each file has 7 fixed sections. Append entries under the right one:

| Section                      | What belongs                                                             |
|------------------------------|--------------------------------------------------------------------------|
| **What Works**               | Approaches and solutions that proved reliable                            |
| **What Doesn't Work**        | Dead ends, antipatterns, dangerous traps *(most skipped; highest value)* |
| **Codebase Patterns**        | Module-specific conventions and architectural decisions                  |
| **Tool & Library Notes**     | Dependency quirks, version-specific behavior, config gotchas             |
| **Recurring Errors & Fixes** | Error → root cause → fix for things easy to hit again                    |
| **Session Notes**            | Dated session summaries — use `### YYYY-MM-DD` subheadings               |
| **Open Questions**           | Unresolved questions worth investigating in a future session             |

## Quality bar: concrete, not banal

Gate test: *"Would this be obvious to anyone reading the code?"* If yes — skip it.

Good entries are **actionable cold**: a future agent reads it and knows exactly what to do.

| Bad (noise)              | Good (signal)                                                                                                    |
|--------------------------|------------------------------------------------------------------------------------------------------------------|
| "Promises can be tricky" | "`Promise.all()` times out past 30 PRs in repo-intel — use `Promise.allSettled()` with batches of 10"            |
| "Be careful with async"  | "The grounding gate (`reviewer-core/src/grounding.ts`) is the final validation — never bypass it to fix a score" |
| "Check error handling"   | "`server/src/modules/index.ts` is the only place to register new modules — no filesystem autoload"               |

## Entry format

```
- **YYYY-MM-DD** — <insight in one sentence>. Evidence: `path/to/file.ts:NN`.
```

Omit `Evidence:` only for purely architectural insights not tied to a specific file.

## Session START behavior

1. Identify the module from the user's request
2. Read that module's `INSIGHTS.md` fully and silently internalize it
3. Do not announce this step — just absorb the context

## Session END behavior

1. Scan the session for non-obvious discoveries, fixes, patterns, or gotchas
2. Draft ≤5 candidates ranked by signal — apply the quality bar ruthlessly
3. Re-read the module's `INSIGHTS.md` to check for duplicates
4. If ≥1 candidate passes: append using `Edit` (never `Write`) under the correct section header
5. If nothing new: write nothing
6. Confirm in one line: *"Added N entries to `server/INSIGHTS.md`: [What Works] + [Recurring Errors & Fixes]."* or *"No new insights this session."*

## Non-destructive write contract

- **NEVER overwrite** an `INSIGHTS.md` — append only
- **Use `Edit`**, not `Write` — `Write` replaces the entire file
- Re-read the file immediately before writing to confirm the section anchor is still there
- Corrections are additive: add a new dated entry, never delete the old one
- If a section header is missing, add it along with the entry — do not create a new file
