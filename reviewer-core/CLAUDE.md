# reviewer-core (@devdigest/reviewer-core)

## Iron rule
No I/O — no DB, fs, GitHub, or persistence. Only the injected `LLMProvider`. Must run identically in the studio and in CI.

## Before answering
Search `reviewer-core/docs/`, `reviewer-core/specs/`, `reviewer-core/INSIGHTS.md` first.

## Conventions (not obvious from code)

- Grounding gate (`src/grounding.ts`) is the final validation layer — scores derive from grounded findings, not the model's raw output.
- Skills, memory, and specs arrive as resolved strings — slug-to-body mapping belongs to the caller, not here.

## Use when

- Architecture, pipeline → read `reviewer-core/README.md`
- Deep-dives → read `reviewer-core/docs/` · specs → read `reviewer-core/specs/` · findings → read `reviewer-core/INSIGHTS.md`
