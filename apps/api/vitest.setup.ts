// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.1 / Plan 03 / Task D-08 — apps/api vitest 4 setupFiles entry.
//
// Re-exports the shared tools/testcontainer-reaper-setup helper that
// installs SIGINT/SIGTERM testcontainer-reaper handlers (formerly inlined
// here, now extracted for apps/worker + packages/data reuse).
//
// `installSignalHook()` is module-scoped idempotent; re-invocations from
// other setup files are safe no-ops.

// Phase 18.1.2 / Plan 02 / D-03 + pitfall §1 — opt-in to the testcontainers
// `withReuse()` daemon-side label hash. MUST be set BEFORE any testcontainer
// module loads (the setting is read once at @testcontainers/postgresql import
// time). Test-only scope: setting it in package.json would leak into the
// app runtime; here it lives only inside vitest workers.
process.env.TESTCONTAINERS_REUSE_ENABLE = "true";

// Phase 19 / Plan 02 (SR-19.3, D-12 + pitfall §7) — BYOK envs for vitest
// workers. After the library refactor (process.exit → throw BYOKGuardError),
// any test that imports `apps/api/src/index.ts` triggers the entrypoint's
// boot-time `assertBYOKConfig()` call. Without these envs the guard throws,
// the entrypoint's catch handler calls `process.exit(1)`, and vitest's
// trap fails the test file at load time. We set the canonical happy-env
// here so all api unit tests see a satisfied BYOK contract; tests that
// need to assert the boot-guard surface itself (none today) can override
// per-file. `OTEL_EXPORTER_OTLP_ENDPOINT=disabled` activates the sentinel
// short-circuit (no OTel dial in tests). `NODE_ENV=test` skips the SMTP
// gate. These do NOT affect production behavior.
process.env.NODE_ENV ??= "test";
process.env.S3_ENDPOINT ??= "https://s3.test.example.com";
process.env.S3_ACCESS_KEY ??= "AKIATEST";
process.env.S3_SECRET_KEY ??= "test-secret";
process.env.S3_BUCKET ??= "openwhispr-test";
// Use a real URL (not the `=disabled` sentinel) so otel-bootstrap's
// SDK instantiates — otel-bootstrap.test.ts asserts `mod.sdk !== null`
// at default load, which is incompatible with the sentinel.
process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??= "http://otel-test.invalid:4317";
process.env.INGRESS_BASE_URL ??= "https://api.test.example.com";
// Phase 53 — Plan 51-16 cascade: when INGRESS_BASE_URL is https://, the
// byok-guard also requires INGRESS_TLS_CERT_PATH (no NODE_ENV gate).
// Set to a placeholder path so the guard returns void; production tests
// never read the file because fastify is mocked or the listener never
// boots with TLS enabled in unit scope.
process.env.INGRESS_TLS_CERT_PATH ??= "/tmp/test-ingress-cert.pem";
process.env.DATABASE_URL ??= "postgres://test/test";

// Phase 33 / Plan 33-04 — MASTER_KEK default for vitest workers so
// EnvKeyProvider.getKek() does not throw at module-load time when the
// lens is instantiated by buildAuth / route plugins. 32 bytes of
// base64url-encoded zeros; production .env is boot-gated by DATA-06.
process.env.MASTER_KEK ??= Buffer.alloc(32).toString("base64url");

import "../../tools/testcontainer-reaper-setup";
