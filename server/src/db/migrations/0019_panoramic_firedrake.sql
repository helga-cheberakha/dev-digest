ALTER TABLE "ci_runs" ADD COLUMN "github_run_id" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_install_run_uq" UNIQUE("ci_installation_id","github_run_id");