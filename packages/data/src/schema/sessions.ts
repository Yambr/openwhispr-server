// Tenant-scoped sessions table. RLS attaches in 0000_initial.sql.
// `token_hash` stores the SHA-256 of the opaque bearer token Phase 2 mints.
// bytea (32 bytes) is wide enough for any future hash choice.
import { customType, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType: () => "bytea",
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: bytea("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("sessions_tenant_id_idx").on(t.tenantId),
    tokenHashIdx: index("sessions_token_hash_idx").on(t.tokenHash),
  }),
);
