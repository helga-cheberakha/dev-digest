CREATE INDEX "findings_review_id_idx" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "reviews_run_id_agent_id_idx" ON "reviews" USING btree ("run_id","agent_id");--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_id_status_ran_at_idx" ON "agent_runs" USING btree ("workspace_id","status","ran_at");