-- Add injection_detected flag to skills for prompt injection detection.
ALTER TABLE "skills"
  ADD COLUMN "injection_detected" boolean NOT NULL DEFAULT false;
