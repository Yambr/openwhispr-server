// SPDX-License-Identifier: FSL-1.1-ALv2
// GET /api/workspaces and GET /api/me/joinable — the workspace bootstrap the
// desktop runs once the team-space capability flag is on.
//
// Upstream models an organization as a self-service SaaS workspace: a user
// creates one, invites people by email, buys seats. None of that maps onto a
// corporate install where the tenant IS the company and identities come from
// the directory. But the desktop still bootstraps through these two endpoints,
// and a 404 on each is a steady error stream plus a workspace store stuck in
// its error state.
//
// So both answer honestly rather than being stubbed out:
//   * /api/workspaces — the tenant, described as the one workspace it is.
//   * /api/me/joinable — empty. Joining is not something a user does here;
//     membership follows the directory, so there is nothing to request.
//
// `role` is "admin" for everyone. It gates the workspace-management UI
// (spacePermissions.canManageWorkspace → owner|admin), and any employee may
// create a team and a space here, so everyone gets that surface. Who may change
// a PARTICULAR team or space is decided per-object in teams.ts and spaces.ts,
// not by this flag.
import { drizzle } from "drizzle-orm/node-postgres";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { buildWorkspacesRoutes, slugify } from "../../../src/routes/workspaces.js";
import { getSharedRoutePool } from "../../support/shared-route-pool.js";

const USER = { id: "22222222-2222-2222-2222-222222222222", email: "a@example.com" };
const TENANT = "00000000-0000-0000-0000-000000000000";

let pool: Pool;

beforeAll(async () => {
  // The route reads the tenant row, so it runs against real Postgres like every
  // other DB-touching route test in this repo.
  pool = await getSharedRoutePool();
}, 180_000);

async function buildApp(opts: { authed: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.addHook("preHandler", async (req) => {
    if (opts.authed) {
      (req as { user?: unknown }).user = USER;
      (req as { tenant?: unknown }).tenant = TENANT;
    }
  });
  await app.register(buildWorkspacesRoutes({ db: drizzle(pool) }));
  await app.ready();
  return app;
}

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

describe("GET /api/workspaces", () => {
  it("describes the tenant as the single workspace", async () => {
    app = await buildApp({ authed: true });

    const res = await app.inject({ method: "GET", url: "/api/workspaces" });

    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: { id: string; role: string; name: string }[] };
    expect(data).toHaveLength(1);
    expect(data[0]!.id).toBe(TENANT);
    expect(data[0]!.role).toBe("admin");
    // Name comes from the tenants row, not from a constant in the handler.
    const { rows } = await pool.query<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [
      TENANT,
    ]);
    expect(data[0]!.name).toBe(rows[0]!.name);
  });

  it("derives a non-empty slug even when the name has no slug-able characters", () => {
    // A tenant named entirely outside the ASCII range slugifies to nothing, and
    // an empty slug would be a broken key rather than a missing one.
    expect(slugify("\u0410\u043b\u044c\u0444\u0430")).toBe("workspace");
    expect(slugify("Acme Corp")).toBe("acme-corp");
  });

  it("carries the billing fields as nulls rather than inventing a plan", async () => {
    app = await buildApp({ authed: true });

    const res = await app.inject({ method: "GET", url: "/api/workspaces" });

    const workspace = (res.json() as { data: Record<string, unknown>[] }).data[0]!;
    // There is no billing here and the fork strips the billing UI entirely.
    // Reporting a fabricated plan/seat count would be the client's only source
    // of truth about something that does not exist.
    expect(workspace.stripe_customer_id).toBeNull();
    expect(workspace.stripe_subscription_id).toBeNull();
    expect(workspace.trial_ends_at).toBeNull();
    expect(workspace.seats).toBe(0);
  });

  it("refuses an unauthenticated caller", async () => {
    app = await buildApp({ authed: false });

    const res = await app.inject({ method: "GET", url: "/api/workspaces" });

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/me/joinable", () => {
  it("returns an empty list — membership is not self-service here", async () => {
    app = await buildApp({ authed: true });

    const res = await app.inject({ method: "GET", url: "/api/me/joinable" });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toEqual([]);
  });

  it("refuses an unauthenticated caller", async () => {
    app = await buildApp({ authed: false });

    const res = await app.inject({ method: "GET", url: "/api/me/joinable" });

    expect(res.statusCode).toBe(401);
  });
});
