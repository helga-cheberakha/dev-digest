ALTER TABLE "eval_runs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_version" integer;--> statement-breakpoint
CREATE INDEX "eval_runs_batch_id_idx" ON "eval_runs" USING btree ("batch_id");