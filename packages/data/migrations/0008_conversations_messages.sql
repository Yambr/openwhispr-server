-- Phase 5 / Plan 01 — conversations + messages.
-- conversations: tsvector GENERATED over coalesce(title,'') with GIN.
-- messages: role CHECK constraint enforces enum at the data layer.

CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"title" text NOT NULL DEFAULT '',
	"archived_at" timestamp with time zone,
	"client_conversation_id" text,
	"content_search" tsvector GENERATED ALWAYS AS (
		to_tsvector('simple', coalesce("title", ''))
	) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "conversations_isolation" ON "conversations"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

CREATE UNIQUE INDEX "conversations_client_id_idx" ON "conversations"
	("tenant_id", "user_id", "client_conversation_id")
	WHERE "client_conversation_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX "conversations_keyset_idx" ON "conversations"
	("tenant_id", "created_at" DESC, "id" DESC)
	WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX "conversations_content_search_idx" ON "conversations" USING GIN ("content_search");
--> statement-breakpoint

-- =====================================================================

CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"role" text NOT NULL,
	"content" text NOT NULL DEFAULT '',
	"metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"client_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "messages_role_check" CHECK ("role" IN ('user', 'assistant', 'system', 'tool'))
);
--> statement-breakpoint

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "messages_isolation" ON "messages"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

CREATE UNIQUE INDEX "messages_client_id_idx" ON "messages"
	("tenant_id", "user_id", "client_message_id")
	WHERE "client_message_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX "messages_keyset_idx" ON "messages"
	("tenant_id", "created_at" DESC, "id" DESC)
	WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX "messages_conversation_idx" ON "messages"
	("conversation_id", "created_at" DESC, "id" DESC)
	WHERE "deleted_at" IS NULL;
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "conversations" TO openwhispr_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON "messages"      TO openwhispr_app;
	END IF;
END $$;
