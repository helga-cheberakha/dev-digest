CREATE TABLE "skill_documents" (
	"skill_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "skill_documents_skill_id_path_pk" PRIMARY KEY("skill_id","path")
);
--> statement-breakpoint
CREATE TABLE "agent_documents" (
	"agent_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_documents_agent_id_path_pk" PRIMARY KEY("agent_id","path")
);
--> statement-breakpoint
ALTER TABLE "skill_documents" ADD CONSTRAINT "skill_documents_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_documents_path_idx" ON "skill_documents" USING btree ("path");--> statement-breakpoint
CREATE INDEX "agent_documents_path_idx" ON "agent_documents" USING btree ("path");
