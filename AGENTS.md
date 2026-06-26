# DevDigest — agent guide

Local-first AI PR reviewer. Course starter: Part-0 works end to end; each lesson adds one feature.

## Before answering
Always search the relevant package's `docs/`, `specs/`, and `INSIGHTS.md` for what the
user asks about FIRST — these are curated and may already answer it — then read code.

## Session protocol (engineering-insights loop)
- **Start:** before touching a package, read its `INSIGHTS.md` and summarize the top 3
  relevant points back — this forces an active read and catches a silently-failed load.
- **Before recording an insight:** re-read that package's `INSIGHTS.md` and do not duplicate
  what's already there.
- **End of session:** run `/engineering-insights`. Record only substantial, file-grounded,
  non-duplicate findings; if nothing substantial came up, write nothing — but don't skip the
  check. Writes are strictly append-only (never overwrite an `INSIGHTS.md`).

## Token optimization

- Spawn **one** research agent with a specific file list; ask it to return full file content + analysis in one pass — do not re-read files the agent already returned in the same context.
- Use `grep` before `Read` for targeted symbol lookups (function name, export, constant).
- Read files in one wider range rather than several small chunks.
- After research completes, write the implementation plan **inline**; do not spawn a Plan agent when research already answers what to build and where.
- Run `/engineering-insights` exactly **once** — after implementation is complete and tests pass, never before.

### Before using Read

- Did an agent already return this file's full content? → use that context, skip `Read`.
- Do I only need one function/variable? → `grep` first, then read the targeted range only.
- Is the file small enough to fit in one call? → read it once with a larger `limit`.

## Session workflow (optimized)

1. Define scope — what exactly needs to change and which files are involved.
2. Run **one** research agent with a specific file list; request full content + analysis + risks.
3. `grep` for any remaining targeted lookups not covered by the agent.
4. Write the implementation plan inline (no Plan agent spawn).
5. Implement changes.
6. Run tests.
7. Run `/engineering-insights` once.
8. Summarize.

## Session review checklist

Before closing a session verify:
- [ ] No duplicate file reads (agent returned content → main agent called `Read` again on the same file).
- [ ] Only one research agent spawned per scope.
- [ ] Plan agent not spawned after research was already complete.
- [ ] `grep` used before targeted `Read` calls.
- [ ] `db:generate` not run when the schema change was a column rename (see `server/CLAUDE.md`).
- [ ] `/engineering-insights` run only after tests passed, and only once.

## Conventions (not obvious from code)
- NOT a monorepo workspace — each package has its own package.json/lockfile; cross-package code is shared via tsconfig path aliases.
- Modules are registered statically in `server/src/modules/index.ts` (no filesystem autoload).
- ESM: relative imports carry the `.js` extension.

## Do-not-touch
- `server/src/vendor/shared/` and `server/src/db/migrations/` — never hand-edit without coordination.

## Use when
- Stack, commands, architecture, how to run → read `README.md`
- Working inside a package → read that package's AGENTS.md: `server/AGENTS.md`, `client/AGENTS.md`, `reviewer-core/AGENTS.md`, `e2e/AGENTS.md`
- Agent prompt templates → read `docs/agent-prompts/`
