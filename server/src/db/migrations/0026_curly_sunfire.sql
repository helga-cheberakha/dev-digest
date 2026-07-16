-- 0020 added workspace_id NOT NULL with no backfill, which fails against any
-- ci_runs row that predates it. This migration is idempotent/safe to run after
-- 0020 in both a fresh DB (ci_runs empty, every statement below is a no-op)
-- and one with existing rows (backfilled via ci_installations -> agents;
-- orphaned rows with no ci_installation_id have no workspace to derive and are
-- dropped -- they were already unreachable through workspace-scoped queries).
ALTER TABLE "ci_runs" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
UPDATE "ci_runs"
SET "workspace_id" = "agents"."workspace_id"
FROM "ci_installations"
JOIN "agents" ON "agents"."id" = "ci_installations"."agent_id"
WHERE "ci_runs"."ci_installation_id" = "ci_installations"."id"
  AND "ci_runs"."workspace_id" IS NULL;--> statement-breakpoint
DELETE FROM "ci_runs" WHERE "workspace_id" IS NULL;--> statement-breakpoint
ALTER TABLE "ci_runs" ALTER COLUMN "workspace_id" SET NOT NULL;
