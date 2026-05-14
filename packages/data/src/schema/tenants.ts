// SPDX-License-Identifier: FSL-1.1-ALv2
// Root tenant table — NOT tenant-scoped. NO RLS attaches here.
// See RESEARCH-DB §"First migration" and CONTEXT D-17 for the seeded
// `default` tenant row with stable UUID 00000000-0000-0000-0000-000000000000.
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
