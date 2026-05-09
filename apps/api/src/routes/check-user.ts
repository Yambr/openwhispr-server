// Phase 2 / Plan 03 / Task 3 — `POST /api/check-user`.
//
// Pre-auth flow used by the desktop "do you have an account?" pivot
// before the user has a session. Resolves the seeded default tenant
// (Phase 1 D-17) and answers "is there a user with this email?".
//
// Wire shape: `{email}` in, `{exists}` out. Both schemas come from
// `@openwhispr/contract-tests/schemas` so Plan 06 conformance hits the
// SAME definitions. `.strict()` on the request rejects extras (T-02-03-07).
//
// Tenant scope: every query runs inside `withTenant(db, tenantId, ...)`
// per WIRE-Q1's safe path (handler-local GUC binding rather than
// preHandler).
//
// Rate-limit (10/min/IP, D-28): supplied via route config; Plan 04
// wires the limiter plugin and reads this config at registration time.
//
// D-09 / T-02-03-03 (email enumeration): documented and accepted for
// v1; rate limit on top mitigates the abuse surface.
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import {
  CheckUserRequest,
  CheckUserResponse,
} from "@openwhispr/contract-tests/schemas";
import { withTenant, type TransactionalDb, type ExecutableTx } from "@openwhispr/data";
import { resolveDefaultTenantId } from "../lib/default-tenant.js";

export interface CheckUserDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildCheckUserRoutes = (deps: CheckUserDeps) =>
  async function checkUserRoutes(app: FastifyInstance): Promise<void> {
    const { db } = deps;
    app.route({
      method: "POST",
      url: "/api/check-user",
      config: {
        auth: false,
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        body: CheckUserRequest,
        response: { 200: CheckUserResponse },
      },
      handler: async (req) => {
        const body = CheckUserRequest.parse(req.body);
        const tenantId = await resolveDefaultTenantId();
        const exists = await withTenant(db, tenantId, async (tx) => {
          // Drizzle's typed builders aren't reachable through the
          // structural TransactionalDb minimum (Plan 03 keeps the
          // handler-side coupling thin so tests can inject a fake).
          // A raw parameterised query is functionally identical to
          // `.select().from(users).where(eq(users.email, ...))` and
          // doesn't drag the schema graph into this file.
          const res = (await tx.execute(
            sql`SELECT 1 FROM users WHERE email = ${body.email} LIMIT 1`,
          )) as { rows: unknown[] };
          return res.rows.length > 0;
        });
        return { exists };
      },
    });
  };

export default buildCheckUserRoutes;
