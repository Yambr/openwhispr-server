-- Phase 5 / Plan 01 — transcriptions table. RLS + soft-delete + partial
-- UNIQUE on client_transcription_id (D-24) + keyset partial idx (D-25).

CREATE TABLE "transcriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"text" text NOT NULL DEFAULT '',
	"language" text,
	"duration_seconds" real,
	"audio_duration_ms" integer,
	"model" text,
	"provider" text,
	"client_transcription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "transcriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transcriptions" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "transcriptions_isolation" ON "transcriptions"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

CREATE UNIQUE INDEX "transcriptions_client_id_idx" ON "transcriptions"
	("tenant_id", "user_id", "client_transcription_id")
	WHERE "client_transcription_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX "transcriptions_keyset_idx" ON "transcriptions"
	("tenant_id", "created_at" DESC, "id" DESC)
	WHERE "deleted_at" IS NULL;
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "transcriptions" TO openwhispr_app;
	END IF;
END $$;
