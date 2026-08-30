// SPDX-License-Identifier: FSL-1.1-ALv2
// GET /api/workspaces/:workspaceId/members — the people picker.
//
// Without this the roster UI has nobody to offer, so "add a colleague to the
// team" is a form with an empty dropdown. Upstream fills it from workspace
// membership records; here the tenant IS the company, so the answer is simply
// the colleagues who have signed in — every one of them is an identity the
// directory already vetted.
//
// It is a picker, not a directory dump: the list carries what the UI shows
// (email, display name) and nothing else. Anything more would make an ordinary
// employee endpoint into an HR export.
import { drizzle } from "drizzle-orm/node-postgres";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { zodTypeProvider } from "../../../src/plugins/zod-type-provider.js";
import { buildWorkspacesRoutes } from "../../../src/routes/workspaces.js";
import { getSharedRoutePool } from "../../support/shared-route-pool.js";

const TENANT = "00000000-0000-0000-0000-000000000000";

let pool: Pool;
let callerId: string;
let app: FastifyInstance;

beforeAll(async () => {
  pool = await getSharedRoutePool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    [TENANT, "picker-caller@test", "Caller"],
  );
  callerId = rows[0]!.id;
}, 180_000);

afterEach(async () => {
  await app?.close();
});

async function buildApp(opts: { authed: boolean }): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  registerErrorHandler(instance);
  await instance.register(zodTypeProvider);
  instance.addHook("preHandler", async (req) => {
    if (opts.authed) {
      (req as { user?: unknown }).user = { id: callerId, email: "picker-caller@test" };
      (req as { tenant?: unknown }).tenant = TENANT;
    }
  });
  await instance.register(buildWorkspacesRoutes({ db: drizzle(pool) }));
  await instance.ready();
  return instance;
}

interface Member {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  joined_at: string;
}

describe("GET /api/workspaces/:workspaceId/members", () => {
  it("offers the colleagues who have signed in", async () => {
    app = await buildApp({ authed: true });

    const res = await app.inject({ method: "GET", url: `/api/workspaces/${TENANT}/members` });

    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: Member[] };
    const me = data.find((m) => m.user_id === callerId);
    expect(me).toBeDefined();
    expect(me?.email).toBe("picker-caller@test");
    expect(me?.name).toBe("Caller");
  });

  it("carries only what the picker renders", async () => {
    app = await buildApp({ authed: true });

    const res = await app.inject({ method: "GET", url: `/api/workspaces/${TENANT}/members` });

    const member = (res.json() as { data: Record<string, unknown>[] }).data[0]!;
    // An ordinary employee calls this. Widening it later is a decision, not an
    // accident, so the shape is pinned.
    expect(Object.keys(member).sort()).toEqual(
      ["email", "image", "joined_at", "name", "role", "user_id"].sort(),
    );
  });

  it("refuses a workspace that is not this tenant", async () => {
    app = await buildApp({ authed: true });

    const res = await app.inject({
      method: "GET",
      url: "/api/workspaces/11111111-1111-4111-8111-111111111111/members",
    });

    expect(res.statusCode).toBe(404);
  });

  it("refuses an unauthenticated caller", async () => {
    app = await buildApp({ authed: false });

    const res = await app.inject({ method: "GET", url: `/api/workspaces/${TENANT}/members` });

    expect(res.statusCode).toBe(401);
  });
});
