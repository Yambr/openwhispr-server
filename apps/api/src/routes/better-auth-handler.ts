// Phase 02.3 — Better Auth catch-all route plugin.
//
// Phase 02 Plan 04 left this wiring undone: buildApp's comments in
// apps/api/src/index.ts step 7 promise `app.all('/api/auth/*', ...)`
// but no plugin actually mounts it. Result: every Better Auth route
// (sign-up/email, sign-in/email, /verify-email, /sign-out, etc.) is
// caught by dualAuthHook BEFORE Better Auth ever sees the request,
// returns 401 unauthorized, and the contract-test seed:conformance
// step cannot create fixture users.
//
// This plugin closes that gap. Two notable details:
//
//   1. config.auth = false — opts the entire `/api/auth/*` namespace
//      out of dualAuthHook. Better Auth maintains its own session
//      check inside `auth.api.getSession`; layering Fastify's hook
//      on top would deadlock self-referential auth operations.
//
//   2. The bridge translates Fastify req → Web Request and Web Response
//      → Fastify reply. Better Auth's universal handler accepts the
//      standard Web `Request` (POST body via stream/text/json), so we
//      reconstruct it from `req.raw` + headers + URL.
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AuthLike } from "../middleware/dual-auth.js";
import { fastifyHeadersToWebHeaders } from "../middleware/dual-auth.js";

export interface BetterAuthHandlerDeps {
  auth: AuthLike;
}

function buildRequestUrl(req: FastifyRequest): string {
  // Reconstruct an absolute URL Better Auth can parse. Use the request
  // host header if present (preserves Origin matching against trustedOrigins).
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const host = (req.headers.host as string | undefined) ?? "localhost";
  return `${proto}://${host}${req.url}`;
}

async function buildRequestBody(req: FastifyRequest): Promise<string | undefined> {
  // GET/HEAD have no body. For everything else, serialize the parsed body
  // back to JSON (Fastify already parsed it via @fastify/type-provider-zod /
  // built-in JSON parser); falling back to raw stream consumption would
  // re-enter Fastify's body parser and double-consume.
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.body === undefined || req.body === null) return undefined;
  if (typeof req.body === "string") return req.body;
  return JSON.stringify(req.body);
}

export const buildBetterAuthHandlerRoutes = (deps: BetterAuthHandlerDeps) =>
  async function betterAuthHandlerRoutes(app: FastifyInstance): Promise<void> {
    const { auth } = deps;

    const handler = auth.handler;
    if (typeof handler !== "function") {
      throw new Error(
        "buildBetterAuthHandlerRoutes: auth.handler is not a function — " +
          "Better Auth instance is missing the universal handler entry point",
      );
    }

    app.all(
      "/api/auth/*",
      { config: { auth: false } },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const url = buildRequestUrl(req);
        const headers = fastifyHeadersToWebHeaders(req.headers);
        const body = await buildRequestBody(req);

        // Conditional body to satisfy exactOptionalPropertyTypes: GET/HEAD
        // requests must omit `body` entirely (RequestInit doesn't accept
        // body: undefined under the strict TS config).
        const init: RequestInit =
          body === undefined
            ? { method: req.method, headers }
            : { method: req.method, headers, body };
        const webReq = new Request(url, init);

        const webRes = await handler(webReq);

        // Forward status + headers. Web Headers may have multiple Set-Cookie
        // values; iterate so each one is appended individually.
        reply.status(webRes.status);
        webRes.headers.forEach((value: string, key: string) => {
          reply.header(key, value);
        });

        // Body: pass through as-is. Better Auth typically returns JSON;
        // text() handles JSON, redirects (empty), and cookie-only responses.
        const text = await webRes.text();
        return reply.send(text || undefined);
      },
    );
  };
