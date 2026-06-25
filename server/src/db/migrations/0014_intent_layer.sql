-- Intent Layer: extend pr_intent with full structured intent fields.
ALTER TABLE "pr_intent" RENAME COLUMN "intent" TO "summary";
ALTER TABLE "pr_intent" ADD COLUMN "risk_areas" jsonb;
ALTER TABLE "pr_intent" ADD COLUMN "model" text NOT NULL DEFAULT '';
ALTER TABLE "pr_intent" ADD COLUMN "tokens_saved" integer;
ALTER TABLE "pr_intent" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "pr_intent" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
