// Tenant-scoped audit log. RLS attaches in 0000_initial.sql.
// No `updated_at` — append-only. JSONB payload, B-tree on created_at;
// GIN index on `payload` is deferred (RESEARCH-DB §Open Q3-equivalent).
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("audit_log_tenant_id_idx").on(t.tenantId),
    createdIdx: index("audit_log_created_at_idx").on(t.createdAt),
  }),
);
