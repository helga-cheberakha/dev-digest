# dev-digest-conventions-l02-2

House conventions for `helga-cheberakha/dev-digest`. Flag changes that violate any rule below and cite the offending `file:line`.

## general
Always use explicit type annotations for function return types and variables.

Detected in `client/src/lib/hooks/skills.ts:0-0`:
```
export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}
```

## general
Always define constants for string literals used as keys or identifiers.

Detected in `server/src/modules/repo-intel/constants.ts:0-0`:
```
export const INDEX_JOB_KIND = 'repo-intel-index';
export const REFRESH_JOB_KIND = 'repo-intel-refresh';
/** Manual "re-analyze": fetch latest from origin + incremental reindex. */
export const RESYNC_JOB_KIND = 'repo-intel-resync';
```

## general
Always organize schema definitions into separate files and re-export them in an index file.

Detected in `server/src/db/schema.ts:0-0`:
```
/**
 * Canonical Drizzle schema — EVERY table in the schema.
 *
 * Tenancy rule: every domain table carries `workspace_id` (FK→workspaces)
 * and, where relevant, `created_by` (FK→users). All queries scope by
 * workspace_id via the base-repository guard.
 *
 * This is the COMPLETE schema. Feature agents A1–A6 do NOT run parallel
 * migrations against these tables — they only extend with their own new
 * columns/tables via their own migrations.
 *
 * The tables are organized into domain files under `./schema/`; this barrel
 * re-exports them so every consumer keeps importing from `db/schema` unchanged.
 */
export * from './schema/core';
export * from './schema/repos';
export * from './schema/pulls';
export * from './schema/reviews';
export * from './schema/skills';
export * from './schema/agents';
export * from './schema/knowledge';
export * from './schema/context';
export * from './schema/eval';
export * from './schema/ci';
export * from './schema/runs';
export * from './schema/ops';
export * from './schema/repo-intel';
```
