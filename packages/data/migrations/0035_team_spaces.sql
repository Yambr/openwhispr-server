-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Team spaces — shared note folders inside the tenant.
--
-- The desktop has shipped the whole team-space UI since 1.9.x and asks this
-- server for it on every sign-in (GET /api/me/spaces). Upstream models it as a
-- self-service SaaS workspace; here the tenant IS the company, so the only new
-- concepts are a SPACE (a shared tree of notes and folders) and a TEAM (who may
-- open it). Everything upstream builds around that — invitations, join
-- requests, seats, billing — has nothing to fill it here and is not created.
--
-- ACCESS CONTROL LIVES IN THE QUERIES, NOT IN RLS. The policies below are
-- TENANT isolation, matching every other table (0018, re-cut by 0033 to honor
-- the `app.bypass` claim). Per-user separation has always been the handlers'
-- own `WHERE user_id =` predicate, and spaces widen that predicate rather than
-- replacing it. Pinned by
-- apps/api/tests/unit/routes/notes/__tests__/space-isolation.integration.test.ts.
--
-- `space_id` on notes and folders is NULLABLE and defaults to NULL: every
-- existing row stays personal, and nothing is migrated or rewritten.
--
-- Forward-looking, deliberately: `teams.ad_group` and `user_groups` are created
-- NOW although nothing writes them yet. Binding a team to a directory group is
-- the next step, and laying the columns down here means that step is code and
-- configuration only — no second migration over live note data.

-- =====================================================================
-- teams — who may open a space.
-- =====================================================================
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"emoji" text,
	-- Directory group this team mirrors, once Dex groupSearch is enabled.
	-- NULL = an explicit member list only.
	"ad_group" text,
	"created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "teams" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "teams_isolation" ON "teams"
	USING (
		current_setting('app.bypass', true) = 'on'
		OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
	)
	WITH CHECK (
		current_setting('app.bypass', true) = 'on'
		OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
	);
--> statement-breakpoint

CREATE UNIQUE INDEX "teams_slug_idx" ON "teams" ("tenant_id", "slug")
	WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- =====================================================================
-- team_members — the explicit roster.
-- =====================================================================
CREATE TABLE "team_members" (
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"role" text NOT NULL DEFAULT 'member',
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("team_id", "user_id")
);
--> statement-breakpoint

ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "team_members" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "team_members_isolation" ON "team_members"
	USING (
		current_setting('app.bypass', true) = 'on'
		OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
	)
	WITH CHECK (
		current_setting('app.bypass', true) = 'on'
		OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
	);
--> statement-breakpoint

-- Membership is read on EVERY note and folder query, keyed by the caller.
CREATE INDEX "team_members_user_idx" ON "team_members" ("tenant_id", "user_id");
--> statement-breakpoint

ALTER TABLE "team_members" ADD CONSTRAINT "team_members_role_check"
	CHECK ("role" IN ('admin', 'member'));
--> statement-breakpoint

-- =====================================================================
-- spaces — the shared tree itself.
-- =====================================================================
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"emoji" text,
	"created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "spaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "spaces" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "spaces_isolation" ON "spaces"
	USING (
		current_setting('app.bypass', true) = 'on'
		OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
	)
	WITH CHECK (
		current_setting('app.bypass', true) = 'on'
		OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
	);
--> statement-breakpoint

CREATE UNIQUE INDEX "spaces_slug_idx" ON "spaces" ("tenant_id", "slug")
	WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- =====================================================================
-- space_teams — which teams may open which space.
-- =====================================================================
CREATE TABLE "space_teams" (
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
	"team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
	-- Ceiling on what the team's members may do in this space. A team admin is
	-- still only a member here if the assignment says so.
	"access" text NOT NULL DEFAULT 'member',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("space_id", "team_id")
);
--> statement-breakpoint

ALTER TABLE "space_teams" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "space_teams" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "space_teams_isolation" ON "space_teams"
	USING (
		current_setting('app.bypass', true) = 'on'
		OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
	)
	WITH CHECK (
		current_setting('app.bypass', true) = 'on'
		OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
	);
--> statement-breakpoint

CREATE INDEX "space_teams_team_idx" ON "space_teams" ("tenant_id", "team_id");
--> statement-breakpoint

ALTER TABLE "space_teams" ADD CONSTRAINT "space_teams_access_check"
	CHECK ("access" IN ('admin', 'member'));
--> statement-breakpoint

-- =====================================================================
-- user_groups — directory groups per user, for the AD-backed teams step.
-- Nothing writes this yet; it exists so that step needs no migration over
-- live note data.
-- =====================================================================
CREATE TABLE "user_groups" (
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"group_name" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("user_id", "group_name")
);
--> statement-breakpoint

ALTER TABLE "user_groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_groups" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "user_groups_isolation" ON "user_groups"
	USING (
		current_setting('app.bypass', true) = 'on'
		OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
	)
	WITH CHECK (
		current_setting('app.bypass', true) = 'on'
		OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
	);
--> statement-breakpoint

CREATE INDEX "user_groups_group_idx" ON "user_groups" ("tenant_id", "group_name");
--> statement-breakpoint

-- =====================================================================
-- notes / folders gain a nullable space scope. NULL = personal, which is
-- what every existing row is and stays.
-- =====================================================================
ALTER TABLE "notes"   ADD COLUMN "space_id" uuid REFERENCES "spaces"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "space_id" uuid REFERENCES "spaces"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- Listing a space's contents is the hot path once spaces are in use.
CREATE INDEX "notes_space_idx" ON "notes" ("tenant_id", "space_id", "updated_at", "id")
	WHERE "deleted_at" IS NULL AND "space_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "folders_space_idx" ON "folders" ("tenant_id", "space_id", "updated_at", "id")
	WHERE "deleted_at" IS NULL AND "space_id" IS NOT NULL;
