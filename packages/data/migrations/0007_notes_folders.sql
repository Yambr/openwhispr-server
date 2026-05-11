-- Phase 5 / Plan 01 — notes + folders. RLS + soft-delete + tsvector GIN +
-- partial UNIQUE on client_*_id (D-24) + keyset partial idx (D-25).
--
-- folders is created BEFORE notes because notes.folder_id FKs into folders.

CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"parent_folder_id" uuid REFERENCES "folders"("id") ON DELETE SET NULL,
	"client_folder_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folders" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "folders_isolation" ON "folders"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

-- Partial UNIQUE on client_folder_id (D-24): scoped (tenant_id, user_id, client_folder_id)
-- WHERE client_folder_id IS NOT NULL — cross-tenant collision impossible
-- by index definition, NULLs allowed in unbounded number per user.
CREATE UNIQUE INDEX "folders_client_id_idx" ON "folders"
	("tenant_id", "user_id", "client_folder_id")
	WHERE "client_folder_id" IS NOT NULL;
--> statement-breakpoint

-- Keyset pagination partial index (D-25). DESC matches LIST routes that
-- show newest first; partial WHERE deleted_at IS NULL keeps the index
-- compact (soft-deleted rows do not consume index space).
CREATE INDEX "folders_keyset_idx" ON "folders"
	("tenant_id", "created_at" DESC, "id" DESC)
	WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- =====================================================================

CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"folder_id" uuid REFERENCES "folders"("id") ON DELETE SET NULL,
	"client_note_id" text,
	"title" text,
	"content" text NOT NULL DEFAULT '',
	-- tsvector GENERATED ALWAYS AS (...) STORED. Pitfall #1: expression
	-- references only own-row immutable columns (coalesce(title,''),
	-- coalesce(content,'')) — no now(), no current_setting, no cross-row
	-- references. Hand-augmented; drizzle-kit cannot emit GENERATED.
	"content_search" tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
		setweight(to_tsvector('simple', coalesce("content", '')), 'B')
	) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notes" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "notes_isolation" ON "notes"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

CREATE UNIQUE INDEX "notes_client_id_idx" ON "notes"
	("tenant_id", "user_id", "client_note_id")
	WHERE "client_note_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX "notes_keyset_idx" ON "notes"
	("tenant_id", "created_at" DESC, "id" DESC)
	WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX "notes_content_search_idx" ON "notes" USING GIN ("content_search");
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "folders" TO openwhispr_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON "notes"   TO openwhispr_app;
	END IF;
END $$;
