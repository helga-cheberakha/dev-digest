-- Extend the conventions stub table for the Conventions Extractor feature.
-- Adds category, line_start, line_end, status, created_at columns
-- and drops the old boolean accepted column (status supersedes it).
ALTER TABLE "conventions"
  ADD COLUMN "category" text NOT NULL DEFAULT '',
  ADD COLUMN "line_start" integer NOT NULL DEFAULT 0,
  ADD COLUMN "line_end" integer NOT NULL DEFAULT 0,
  ADD COLUMN "status" text NOT NULL DEFAULT 'pending',
  ADD COLUMN "created_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "conventions" DROP COLUMN IF EXISTS "accepted";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conventions_repo_idx" ON "conventions"("repo_id");
