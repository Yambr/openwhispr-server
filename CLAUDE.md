<!-- GSD:project-start source:PROJECT.md -->
## Project

**OpenWhispr Server**

An open-source, enterprise-grade, self-hosted backend for the OpenWhispr Electron desktop client, implementing the wire surface defined by the upstream `SELF_HOSTING.md` / `BACKEND_SPEC.md` / `OAUTH_SPEC.md` (1556 lines of authoritative spec). It bundles a default **LiteLLM Proxy** wired to **open-source AI models** (Whisper for transcription, pyannote for diarization, faster-whisper / Speaches-compatible image for realtime) so a fresh `git clone && docker compose up` works out of the box for OSS users, while corporate operators override `LITELLM_BASE_URL` / `LITELLM_VIRTUAL_KEY` to point at their existing internal LiteLLM Proxy (see `docs/litellm-target-spec.md` for the canonical corporate example) without any code changes — LiteLLM is itself the abstraction layer.

It is built to enterprise standards for **1000 concurrent active users** in one installation: HA Postgres with row-level multi-tenancy, horizontal autoscaling, BullMQ workers, anti-abuse rate limiting, full observability, and reproducible deploys via docker-compose (single-host self-host) and Helm (Kubernetes cloud).

**Core Value:** **A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.** Every other goal (multi-tenancy, observability, OSS docs, UI-SPEC) exists to serve this one outcome.

### Constraints

- **Tech stack (server)**: Node.js 24 LTS + Fastify 5 + TypeScript + Better Auth + Drizzle + Postgres 17 + PgBouncer + Redis/Valkey + BullMQ — boring, well-staffed, multi-arch (amd64+arm64).
- **Tech stack (frontend)**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui v2 — UI-SPEC target only in v1.
- **Database**: PostgreSQL 17+ — non-negotiable.
- **AI plane**: bundled LiteLLM ≥ v1.83.7-stable in default compose with open-source models; corporate operators env-override to point at their internal LiteLLM.
- **Wire compatibility**: every endpoint we serve matches `BACKEND_SPEC.md` byte-for-byte (JSON shapes, status codes, error envelope, NDJSON streaming, channel-scheme echo, `set-auth-token` rotation).
- **HTTPS only**: never plaintext HTTP on any externally reachable port.
- **Concurrency**: 1000 active concurrent users single installation, p95 latency budgets validated by load test.
- **Source-artifact language**: **English only** for docs, code, comments, commit messages, identifiers, log keys — hard rule.
- **Runtime localization**: `en` + `ru` minimum from day one for UI copy, emails, end-user error messages.
- **Engineering discipline (constitutional, NON-NEGOTIABLE)**:
  - **Strict TDD** — RED → GREEN → REFACTOR; tests precede production code on EVERY phase (including X.Y). Each fix lands with its tests in the SAME atomic commit.
  - **Per-phase coverage floor ≥ 90%** on lines/branches/functions/statements for all new/modified code. Verifier reports `gaps_found` on any sub-90 axis.
  - **E2E mandatory** — every phase touching a user-visible route, wire surface, or operator-facing artifact ships at least one e2e test booting the real `docker compose` stack (or hermetic mock-LiteLLM); lives in `tests/e2e/`, gated by `E2E=1`, run via `make e2e-test`.
  - **No mocks of internal logic** — mocks allowed only at process/network boundaries (third-party SaaS HTTP, OS time, filesystem). DB-touching code uses real Postgres + PgBouncer + Valkey via testcontainers.
  - **GitHub Actions** is the only sanctioned CI; workflows in `.github/workflows/` from phase 0. CI runs unit + integration + contract + e2e on every PR.
  - **Maximum test automation** — no human QA; coverage spans unit, integration, e2e, contract (vs `BACKEND_SPEC.md`), load (1000 concurrent), security (SAST + deps + container + secrets + license), migration safety, i18n completeness, RLS-isolation property tests.
  - **Verification gate** — phase passes only when (a) every must_have observable truth verified against live codebase, (b) coverage ≥ 90/90/90/90 on diff, (c) e2e suite green.
  - 11. **No NODE_ENV branches in runtime paths.** `process.env.NODE_ENV` and `NODE_ENV` comparisons MAY appear ONLY in `bootstrap.ts`, `config/*.ts`, `otel-bootstrap.ts`, `*.config.ts`. Anywhere else in `apps/**/src/**` + `packages/**/src/**` is REFUSED. Enforced by `tools/lint-no-env-branches.ts` (LOCKER-01).
  - 12. **No type-suppression.** `as any`, `as unknown as`, `@ts-ignore`, `@ts-nocheck` are REFUSED in production code. `@ts-expect-error` is permitted ONLY in the format `@ts-expect-error issue-NNNN: <reason>`. Allowlist exists for pre-existing debt; net additions REFUSE the PR. Enforced by `tools/lint-no-suppressions.ts` (LOCKER-02). The related defence-in-depth invariant — Error subclasses MUST truncate `bodyText|responseBody|upstreamPayload|response|body` string fields at construction — is enforced by `tools/lint-secret-shape-in-error.ts` (LOCKER-05).
  - 13. **No hardcoded localhost / UUID / test-token shapes.** `localhost`, `127.0.0.1`, ports `:3000|:4000|:8080`, UUID literals, and secret-shape literals (`sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`, `Bearer ey…`) are REFUSED outside `tests/`, `.env.*.example`, `compose/`, `docs/`, `charts/`, `tools/`. The canonical `DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000'` is permanently allowlisted. Enforced by `tools/lint-no-hardcode.ts` (LOCKER-03).
  - 14. **Production-readiness invariants.** Every Fastify route declaration (`app.route|get|post|put|patch|delete`) MUST carry `schema: { body|querystring|params: <ZodSchema> }` AND `config: { rateLimit: ... }`. `rateLimit: false` is permitted ONLY for `/api/health|/api/ready|/api/healthz|/api/_test/*` URLs. Every exported symbol MUST have at least one non-test importer. The related defence-in-depth invariant — `child_process.spawn('bash', ['-c', ...])` / `execSync` / `exec` / `execFileSync` MUST NOT interpolate template-literal credentials referencing `*_URL|*_KEY|*_PASSWORD|*_SECRET|*_TOKEN` bindings — is enforced by `tools/lint-shell-credential-interpolation.ts` (LOCKER-06). Use argv-array form `spawn(cmd, [arg, ...], { shell: false })` instead. Enforced by `tools/lint-prod-readiness.ts` (LOCKER-04) + LOCKER-06. **WARN→BLOCKING ledger (post-31-08):** LOCKER-04's BLOCKING flip is operationally deferred from Plan 31-08 to Phase 41 closure (Phase 41 closes the 47-route bulkfix backlog with per-route TDD pairs; the dead-export backlog is Phase 38's `@openwhispr/auth` retirement). LOCKER-05 flips in Phase 37; LOCKER-06 flips in Phase 36.a. Rationale lives in `.planning/phases/31-constitutional-lockers/31-08-DECISIONS.md §D-1`.
- **Open source**: every requirement ships with corresponding documentation; no closed/internal subsystems.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK-SUMMARY.md -->
## Technology Stack

> Quick-scan reference. Full rationale, alternatives, "what NOT to use", and citation sources live in `.planning/research/STACK.md`.

### TL;DR — One-Line Picks

| Layer | Pick | Version |
|---|---|---|
| Runtime | Node.js (Active LTS) | **24.x** |
| HTTP framework | **Fastify** | **5.x** |
| Auth library | **Better Auth (server)** + Bearer + JWT + OAuth Provider plugins | **1.x** |
| Database | **PostgreSQL** | **17.x** |
| Schema/ORM | **Drizzle ORM** + **drizzle-kit** | latest |
| Pooler | **PgBouncer** transaction mode | **1.23+** |
| HA Postgres (K8s) | **CloudNativePG** operator | **1.29.x** |
| Cache / rate-limit / WS fan-out | **Redis** (or **Valkey**) | **7.4 / 8.x** |
| Job queue | **BullMQ** | latest |
| LLM/audio gateway (default) | **LiteLLM Proxy** | **v1.83.7-stable+** (multipart-passthrough fix native) |
| ASR/Realtime backend (default) | **Speaches** (`speaches-local:master-cuda-12.6.3+`) | latest master |
| Object storage (self-host) | **MinIO** (S3-compatible) | latest |
| Observability | **OTel SDK → OTel Collector → Tempo + Mimir/Prometheus + Loki + Grafana** (LGTM) | latest |
| Logs shipping | **OTel Collector** (no Vector required) | — |
| Container orchestration | **docker-compose** (single-host) + **Helm chart** (K8s) | — |
| Ingress (K8s) | **Traefik 3** (primary) / Envoy Gateway / Contour | Traefik 3.x |
| i18n | **i18next** + **i18next-http-middleware** + **i18next-icu** + **accept-language-parser** | latest |
| Frontend (UI-SPEC target) | **Next.js 15 (App Router) + React 19 + Tailwind 4 + shadcn/ui** | latest |

### Stack Patterns by Variant

- **Self-host single-VM (OSS quickstart)** — docker-compose, Traefik with ACME, single-replica everything, MinIO single-disk, Postgres no replicas (rely on `pg_dump` cron + WAL archive to MinIO), Prometheus single-binary, Grafana single-binary. Skip Speaches GPU → route to a hosted Whisper API via LiteLLM.
- **Cloud / production HA** — K8s + Helm, Traefik or Envoy Gateway, CloudNativePG 1 primary + 2 replicas + automated failover, MinIO distributed (4 nodes), Speaches with HPA on GPU utilization (≥ 2× L40S), full LGTM stack, OTel Collector as DaemonSet, BullMQ workers as separate Deployment with HPA on Redis queue depth.
- **Corporate self-host (enterprise override)** — replace Let's Encrypt with cert-manager + internal CA Issuer, wire Keycloak/Authentik as Better Auth's upstream OAuth Provider, point LiteLLM at on-prem LLM gateway (vLLM, internal Bedrock proxy, etc.), MinIO backs everything.

### Version Compatibility Matrix

| Package A | Compatible With | Notes |
|---|---|---|
| Node.js 24 LTS | Fastify 5, Better Auth 1.x, Drizzle latest | Active LTS through Apr 2027 |
| Fastify 5 | `@fastify/multipart` ≥ 9.x, `@fastify/websocket` ≥ 11.x, `@fastify/http-proxy` ≥ 11.x | Older v4-pinned plugins won't work |
| Drizzle | pg ≥ 8, postgres-js ≥ 3 | `pg` more compatible with PgBouncer transaction mode |
| PgBouncer 1.23+ | Postgres 17 | Transaction-mode prepared-statement support requires 1.23+ |
| BullMQ | Redis 7.x or Valkey 8.x | Streams + consumer groups required |
| LiteLLM v1.83.7-stable+ | Speaches master-cuda-12.6.3+ | Multipart pass-through fix native |
| CloudNativePG 1.29 | K8s 1.28+ | Default image catalog is PG 18 — override to PG 17 in Cluster spec |
| Tailwind 4 | shadcn/ui latest, React 19 | Older shadcn/ui (Tailwind 3) requires migration |
| OTel SDK Node | Node 18+ | Trace + metrics stable; logs API stable |

### Hard "do not use" shortlist

- **Express 4/5**, **Prisma**, **TypeORM**, **MySQL/MariaDB**, **Postgres 16/18**, **`kubernetes/ingress-nginx`** (EOL March 2026), **LiteLLM v1.82.x** (multipart bug), **Jaeger**, **ELK**, **node-polyglot**, **Roll-your-own JWT/auth**, **Bun in production**, **Pages Router**, **CRA**.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

### Hard Rules (user-mandated, NON-NEGOTIABLE)

1. **NEVER edit production server code to make tests pass.** Do not touch `packages/data/migrations/*.sql`, route handlers, plugin source, schema definitions, or any other production artefact ONLY to satisfy a failing test. If a test fails because the production code has a hardcoded value (e.g., `"public".tenants` FK reference), the test is wrong or the test infrastructure is wrong — never the production code. Document the constraint in `.planning/deferred-items.md` for future targeted production-fix phase; do NOT silently rewrite production SQL/code under the guise of a test fix.

2. **Surface costly architectural decisions as deferred-items, not in-flight rewrites.** When a test infrastructure approach (e.g., search_path-per-schema isolation) is blocked by production-code constraints, log it in `.planning/deferred-items.md` with `WHY:` evidence and use the next-best-pragmatic-but-non-invasive pattern. A future phase + user decision can change production. The current phase's job is to close test debt without invading server surface.

3. **NEVER report "✅ done" based solely on a sub-agent's claim.** When a spawned executor / advisor / researcher returns a summary, the orchestrator (main agent) MUST independently verify before claiming completion to the user. Verification means:
   - **(a) Commits exist:** `git log --oneline -<N>` confirms each cited SHA is on HEAD
   - **(b) Tests are GREEN:** for test-fix work, re-run the cited `pnpm test <pattern>` command and read the exit code + summary line with own eyes
   - **(c) Files have the claimed edits:** `grep <fingerprint-line> <file>` for state/ROADMAP/docs edits
   - **(d) Working tree state is clean:** `git status --short` shows expected state (no orphaned partial edits, no untracked debris)
   - **(e) For HALT cases:** confirm working tree is at the SHA the sub-agent named, not silently divergent
   
   A sub-agent's textual `## PLAN COMPLETE` block is INPUT, not PROOF — treat it like CI output you have to parse and validate. The user has direct evidence (file diffs, git log, IDE diagnostics) that contradict false reports.
   
   **Trust but verify** from `~/.claude/CLAUDE.md` global rules is INHERITED HERE as constitutional. The cheapest failure mode is the orchestrator parroting a sub-agent's optimistic summary verbatim and the user discovering the lie via their IDE.

4. **NEVER bypass the gitleaks pre-commit / pre-push hooks.** `git commit --no-verify` and `git push --no-verify` are prohibited for any commit that adds or modifies files containing potential credential shapes. The hooks (lefthook pre-commit + pre-push using `.gitleaks.toml`) are defense-in-depth Layer 1 + 2; CI gitleaks-action (`.github/workflows/security.yml`) is Layer 3 — by the time CI fires, the secret is already on GitHub remote and ROTATION is mandatory. If a hook fires on a legitimate test placeholder, the fix is to extend `.gitleaks.toml` allowlist + add a regression assertion in `tools/lint-gitleaks-config.test.ts` — NEVER to bypass. Runbook: `docs/security/secret-leak-runbook.md`.

### Tactical conventions

Conventions not yet otherwise established. Will populate as patterns emerge.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
