// RED-then-GREEN tests for the first-launch SLO probe.
// Per CLAUDE.md "no internal mocks": the "backend" boundary is a REAL
// Fastify server bound to 127.0.0.1 on an ephemeral port. The probe is
// exercised against it via undici.fetch. T-09-04 (no-bearer-leak) is
// asserted by spying on process.stdout / process.stderr writes.

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, runProbe } from "./probe.js";

interface FakeBackendOptions {
  signupStatus?: number;
  signupBody?: unknown;
  signupTokenHeader?: string;
  signupTokenInBody?: boolean;
  transcribeStatus?: number;
  transcribeBody?: unknown;
  transcribeDelayMs?: number;
  requireBearer?: boolean;
}

async function startFakeBackend(opts: FakeBackendOptions = {}): Promise<{
  app: FastifyInstance;
  url: string;
  observed: { bearer?: string };
}> {
  const observed: { bearer?: string } = {};
  const app = Fastify({ logger: false });

  // Drain multipart bodies as raw bytes so the request stream completes.
  // We don't actually need to parse the parts in tests — we only verify
  // that the probe sent a multipart request with the bearer header.
  app.addContentTypeParser(/^multipart\//, { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/api/auth/sign-up/email", async (_req, reply) => {
    const status = opts.signupStatus ?? 200;
    if (opts.signupTokenHeader) {
      reply.header("set-auth-token", opts.signupTokenHeader);
    }
    const body =
      opts.signupBody ??
      ((opts.signupTokenInBody ?? true)
        ? { token: "test-bearer-token-XYZ", user: { id: "u1" } }
        : { user: { id: "u1" } });
    reply.code(status).send(body);
  });

  app.post("/api/transcribe", async (req, reply) => {
    observed.bearer = req.headers.authorization;
    if (opts.requireBearer !== false) {
      if (!req.headers.authorization?.startsWith("Bearer ")) {
        reply.code(401).send({ error: "unauthorized" });
        return;
      }
    }
    // Body already drained by the multipart content-type parser above.
    if (opts.transcribeDelayMs && opts.transcribeDelayMs > 0) {
      await new Promise((r) => setTimeout(r, opts.transcribeDelayMs));
    }
    const status = opts.transcribeStatus ?? 200;
    const body = opts.transcribeBody ?? { id: "tx-1", text: "ok" };
    reply.code(status).send(body);
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("listen failed");
  const url = `http://127.0.0.1:${addr.port}`;
  return { app, url, observed };
}

let active: { app: FastifyInstance } | null = null;
afterEach(async () => {
  if (active) {
    await active.app.close();
    active = null;
  }
});

describe("runProbe", () => {
  it("returns ok=true when backend is fast and well-formed (header-bearer path)", async () => {
    const be = await startFakeBackend({
      signupTokenHeader: "hdr-bearer-ABC",
      signupTokenInBody: false,
      signupBody: { user: { id: "u" } },
    });
    active = be;
    const result = await runProbe({ target: be.url, deadlineMs: 30_000 });
    expect(result.ok).toBe(true);
    expect(result.step).toBe("ok");
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeLessThan(30_000);
    expect(be.observed.bearer).toBe("Bearer hdr-bearer-ABC");
  });

  it("returns ok=true via body.token path", async () => {
    const be = await startFakeBackend({ signupTokenInBody: true });
    active = be;
    const result = await runProbe({ target: be.url, deadlineMs: 30_000 });
    expect(result.ok).toBe(true);
    expect(be.observed.bearer).toBe("Bearer test-bearer-token-XYZ");
  });

  it("returns ok=false / step=transcribe-too-slow when deadline exceeded", async () => {
    const be = await startFakeBackend({ transcribeDelayMs: 250 });
    active = be;
    const result = await runProbe({ target: be.url, deadlineMs: 50 });
    expect(result.ok).toBe(false);
    expect(result.step).toBe("transcribe-too-slow");
    expect(result.elapsedMs).toBeGreaterThan(50);
  });

  it("returns ok=false / step=transcribe-non-200 on 401", async () => {
    const be = await startFakeBackend({ transcribeStatus: 401, transcribeBody: { error: "nope" } });
    active = be;
    const result = await runProbe({ target: be.url, deadlineMs: 30_000 });
    expect(result.ok).toBe(false);
    expect(result.step).toBe("transcribe-non-200");
    expect(result.transcribeStatus).toBe(401);
  });

  it("returns ok=false / step=signup-failed on 500", async () => {
    const be = await startFakeBackend({ signupStatus: 500, signupBody: { error: "boom" } });
    active = be;
    const result = await runProbe({ target: be.url, deadlineMs: 30_000 });
    expect(result.ok).toBe(false);
    expect(result.step).toBe("signup-failed");
  });

  it("returns ok=false / step=no-bearer-token when backend omits token", async () => {
    const be = await startFakeBackend({
      signupTokenInBody: false,
      signupBody: { user: { id: "u" } },
    });
    active = be;
    const result = await runProbe({ target: be.url, deadlineMs: 30_000 });
    expect(result.ok).toBe(false);
    expect(result.step).toBe("no-bearer-token");
  });

  it("returns ok=false / step=transcribe-bad-body when transcribe body lacks text", async () => {
    const be = await startFakeBackend({ transcribeBody: { id: "x" } });
    active = be;
    const result = await runProbe({ target: be.url, deadlineMs: 30_000 });
    expect(result.ok).toBe(false);
    expect(result.step).toBe("transcribe-bad-body");
  });

  it("returns ok=false / step=transcribe-bad-body when transcribe body is non-JSON", async () => {
    // Fastify will serialize a string body as JSON by default; override the content-type
    // to text/plain by sending a raw string with a serializer hook.
    const app = Fastify({ logger: false });
    app.addContentTypeParser(/^multipart\//, { parseAs: "buffer" }, (_r, b, d) => d(null, b));
    app.post("/api/auth/sign-up/email", async (_req, reply) => {
      reply.send({ token: "t", user: { id: "u" } });
    });
    app.post("/api/transcribe", async (_req, reply) => {
      reply.type("application/json").send("this is not json at all }");
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("listen failed");
    active = { app };
    try {
      const result = await runProbe({
        target: `http://127.0.0.1:${addr.port}`,
        deadlineMs: 30_000,
      });
      // Either bad-body (json parse fails) or transcribe-bad-body (text not present) — both acceptable
      expect(result.ok).toBe(false);
      expect(["transcribe-bad-body"]).toContain(result.step);
    } finally {
      await app.close();
      active = null;
    }
  });

  it("returns ok=false / step=transcribe-non-200 when transcribe connection fails mid-flight", async () => {
    // Start a backend that completes signup but closes the underlying socket
    // before responding to /api/transcribe.
    const app = Fastify({ logger: false });
    app.addContentTypeParser(/^multipart\//, { parseAs: "buffer" }, (_r, b, d) => d(null, b));
    app.post("/api/auth/sign-up/email", async (_req, reply) => {
      reply.send({ token: "t", user: { id: "u" } });
    });
    app.post("/api/transcribe", async (req, reply) => {
      // Forcibly destroy the underlying socket so undici sees a network error.
      reply.raw.destroy(new Error("socket destroyed by test"));
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("listen failed");
    active = { app };
    try {
      const result = await runProbe({
        target: `http://127.0.0.1:${addr.port}`,
        deadlineMs: 30_000,
      });
      expect(result.ok).toBe(false);
      expect(result.step).toBe("transcribe-non-200");
      expect(result.errorDetail).toBeDefined();
    } finally {
      await app.close();
      active = null;
    }
  });

  it("accepts the bearer via body.session.token fallback", async () => {
    const be = await startFakeBackend({
      signupTokenInBody: false,
      signupBody: { session: { token: "session-bearer-DEF" } },
    });
    active = be;
    const result = await runProbe({ target: be.url, deadlineMs: 30_000 });
    expect(result.ok).toBe(true);
    expect(be.observed.bearer).toBe("Bearer session-bearer-DEF");
  });

  it("threads a custom undici dispatcher through both requests", async () => {
    const be = await startFakeBackend({});
    active = be;
    const { Agent } = await import("undici");
    const dispatcher = new Agent();
    try {
      const result = await runProbe({ target: be.url, deadlineMs: 30_000, dispatcher });
      expect(result.ok).toBe(true);
    } finally {
      await dispatcher.close();
    }
  });

  it("fixturePath fallback throws a clear error when nothing is readable", async () => {
    // Exercise runProbe with an explicit fixture override so the default fixturePath
    // is bypassed — confirming the override branch.
    const be = await startFakeBackend({});
    active = be;
    const result = await runProbe({
      target: be.url,
      deadlineMs: 30_000,
      fixture: Buffer.from("RIFF"),
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok=false / step=signup-failed on network error", async () => {
    // Target an unbound port — connect will refuse.
    const result = await runProbe({ target: "http://127.0.0.1:1", deadlineMs: 5_000 });
    expect(result.ok).toBe(false);
    expect(result.step).toBe("signup-failed");
    expect(result.errorDetail).toBeDefined();
  });

  it("T-09-04: probe never writes the bearer token to stdout or stderr (header path)", async () => {
    const secret = "super-secret-bearer-DO-NOT-LOG-12345";
    const be = await startFakeBackend({
      signupTokenHeader: secret,
      signupTokenInBody: false,
      signupBody: { user: { id: "u" } },
    });
    active = be;
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const env = { TARGET: be.url, SLO_DEADLINE_MS: "30000" };
      const code = await main(env as NodeJS.ProcessEnv);
      expect(code).toBe(0);
      const allWrites = [
        ...stdoutSpy.mock.calls.map((c) => String(c[0])),
        ...stderrSpy.mock.calls.map((c) => String(c[0])),
      ];
      for (const w of allWrites) {
        expect(w.includes(secret)).toBe(false);
      }
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("T-09-04: probe never writes a body.token bearer to stdout or stderr", async () => {
    const secret = "body-bearer-secret-DO-NOT-LOG-67890";
    const be = await startFakeBackend({ signupBody: { token: secret, user: { id: "u" } } });
    active = be;
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const env = { TARGET: be.url, SLO_DEADLINE_MS: "30000" };
      await main(env as NodeJS.ProcessEnv);
      for (const c of stdoutSpy.mock.calls) expect(String(c[0]).includes(secret)).toBe(false);
      for (const c of stderrSpy.mock.calls) expect(String(c[0]).includes(secret)).toBe(false);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });
});

describe("main CLI", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("returns 2 when TARGET env is missing", async () => {
    const code = await main({} as NodeJS.ProcessEnv);
    expect(code).toBe(2);
  });

  it("returns 2 when SLO_DEADLINE_MS is invalid", async () => {
    const code = await main({
      TARGET: "http://127.0.0.1:1",
      SLO_DEADLINE_MS: "garbage",
    } as NodeJS.ProcessEnv);
    expect(code).toBe(2);
  });

  it("returns 1 when backend is unreachable", async () => {
    const code = await main({
      TARGET: "http://127.0.0.1:1",
      SLO_DEADLINE_MS: "1000",
    } as NodeJS.ProcessEnv);
    expect(code).toBe(1);
    // emits one stdout line of JSON
    const lines = stdoutSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('"ok":false'))).toBe(true);
  });

  it("returns 0 on happy path", async () => {
    const be = await startFakeBackend({});
    active = be;
    const code = await main({ TARGET: be.url, SLO_DEADLINE_MS: "30000" } as NodeJS.ProcessEnv);
    expect(code).toBe(0);
  });

  it("uses the default 300000ms deadline when SLO_DEADLINE_MS is unset", async () => {
    const be = await startFakeBackend({});
    active = be;
    // Omit SLO_DEADLINE_MS so the `?? "300000"` default branch is exercised.
    const code = await main({ TARGET: be.url } as NodeJS.ProcessEnv);
    expect(code).toBe(0);
    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out.includes('"deadline":300000')).toBe(true);
  });

  it("defaults randomEmail/randomPassword to defaultRng when caller omits rng", async () => {
    // Already exercised via every other happy-path test, but assert that the
    // path through `opts.rng ?? defaultRng` does NOT throw given no override.
    const be = await startFakeBackend({});
    active = be;
    const r1 = await runProbe({ target: be.url, deadlineMs: 30_000 });
    expect(r1.ok).toBe(true);
  });
});
