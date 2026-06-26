# server (@devdigest/api)

## Before answering
Search `server/docs/`, `server/specs/`, `server/INSIGHTS.md` for the topic before reading code.

## Conventions (not obvious from code)
- Multi-tenancy: every domain table has `workspace_id`; queries are scoped by the base-repository guard.
- DI via `src/platform/container.ts`: services depend on interfaces (`@devdigest/shared`), not classes; tests inject mocks via `ContainerOverrides`.
- repo-intel is reached ONLY through the facade `container.repoIntel.*` — never touch the pipeline directly.
- Context enrichment is best-effort: on error/unindexed, omit the section, don't throw.
- New feature = new module + one line in `src/modules/index.ts`; new columns = your own migration only.
- **Drizzle migration rename gate:** Before running `npm run db:generate`, check if the schema diff includes a column rename. If yes — write the `ALTER TABLE … RENAME COLUMN old TO new` SQL manually and add the entry to `src/db/migrations/meta/_journal.json` with the next `idx`. Do NOT run `db:generate` for renames — it opens an interactive TTY prompt that blocks non-TTY environments (pipes `stdin` → no response → hangs). Use `db:generate` only for pure additions/deletions.

## Use when
- Overview, commands, route/API map → read `server/README.md`
- Indexer internals → read `server/src/modules/repo-intel/README.md`
- Deep-dives → read `server/docs/` · feature specs/acceptance → read `server/specs/` · gotchas/findings → read `server/INSIGHTS.md`
