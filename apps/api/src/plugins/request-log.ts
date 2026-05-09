// Phase 2 / Plan 03 / Task 3 — `x-openwhispr-source` request-log tag
// (D-16 / WIRE-19).
//
// The desktop client sends `x-openwhispr-source: desktop` on every
// request so server logs can be filtered to client-traffic-only when
// triaging. We mirror it onto every `req.log` child so structured log
// lines carry it automatically.
//
// `null` is the explicit value when the header is absent, which is
// preferable to leaving the field undefined (Loki / Grafana queries
// can match on the canonical absent-value sentinel rather than special-
// casing the missing-field branch).
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

async function requestLogInner(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req) => {
    const raw = req.headers["x-openwhispr-source"];
    const source = typeof raw === "string" ? raw : null;
    req.log = req.log.child({ openwhisprSource: source });
  });
}

export const requestLog = fp(requestLogInner, {
  name: "request-log",
  fastify: "5.x",
});
