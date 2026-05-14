# Phase 13: E2E + CJM Harness (v2 — ships first) — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 16 (NEW + MODIFIED)
**Analogs found:** 14 / 16 (2 have no analog — `tests/e2e-cjm/` Cucumber harness, `bddgen.config.ts`)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| NEW `packages/email/src/EmailSender.ts` | service (shared library) | request-response (SMTP) | `apps/api/src/email.ts` | **exact** (verbatim extract) |
| NEW `packages/email/src/index.ts` | package barrel | n/a | `packages/litellm-client/src/index.ts` | exact |
| NEW `packages/email/package.json` | config | n/a | `packages/litellm-client/package.json` | exact |
| NEW `packages/email/tsconfig.json` | config | n/a | `packages/litellm-client/tsconfig.json` | exact |
| NEW `packages/email/vitest.config.ts` | config | n/a | `packages/litellm-client/vitest.config.ts` | exact |
| NEW `packages/email/src/EmailSender.test.ts` | test (unit) | request-response | `apps/api/src/email.test.ts` | exact |
| NEW `tools/lint-weak-assertions.ts` | utility (lint) | batch (file scan) | `tools/lint-english.ts` | exact (role + data flow) |
| NEW `tools/lint-weak-assertions.test.ts` | test (unit) | batch | `tools/lint-english.test.ts` | exact |
| NEW `tools/lint-cjm-doc.ts` | utility (lint) | batch (markdown parse) | `tools/lint-docs-headings.ts` | exact |
| NEW `tools/global-vitest-teardown.ts` | utility (test infra) | event-driven (process signals) | `tests/e2e/helpers/phase6-compose.ts` (cleanup section) | role-match |
| NEW `tools/__tests__/global-vitest-teardown.test.ts` | test (integration) | event-driven | `tools/lint-english.test.ts` (execFileSync style) | role-match |
| NEW `tools/__tests__/readiness-probe.test.ts` | test (integration) | request-response | `tests/e2e/compose-helper.ts` (waitForApiHealth) | role-match |
| NEW `.github/workflows/e2e-cjm.yml` | config (CI) | event-driven (GHA) | `.github/workflows/ci.yml` (job `e2e-hermetic`, lines 385–432) | exact |
| NEW `docs/customer-journeys.md` | doc | n/a | `docs/wire-contracts-phase-3.md` (headings-driven structure) | role-match |
| NEW `tests/e2e-cjm/` Cucumber harness | test (e2e) | event-driven | (none — first Cucumber harness in repo) | **no analog** |
| NEW `tests/e2e-cjm/bddgen.config.ts` | config | n/a | (none — first playwright-bdd config) | **no analog** |
| NEW `tests/e2e-cjm/support/compose-harness.ts` | utility (test infra) | event-driven | `tests/e2e/compose-helper.ts` + `tests/e2e/helpers/phase6-compose.ts` | exact (wraps the former) |
| NEW `Makefile` target `e2e-cjm` | config (build) | n/a | `Makefile` target `e2e-hermetic` (lines 249–253) and `e2e-test-phase6` (lines 279–298) | exact |
| MODIFY `apps/worker/src/index.ts` (lines 66–134) | controller (process entry) | request-response | self (replace `noopSender` with imported `createEmailSender(env)`) | exact |
| MODIFY `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx` | test (component) | n/a | self — rewrite 3 weak-assertion sites | exact |
| MODIFY `apps/web/src/components/screens/notes/__tests__/NoteDetailClient.test.tsx` | test (component) | n/a | self — 2 sites | exact |
| MODIFY `apps/web/src/components/screens/notes/__tests__/NotesListClient.test.tsx` | test (component) | n/a | self — 4 sites | exact |
| MODIFY `apps/api/src/routes/health.ts` | controller (HTTP) | request-response | self — add `migrations_completed` field | exact |
| MODIFY `apps/api/vitest.setup.ts` (does NOT yet exist as a setup file — see "No Analog Found") | utility (test infra) | event-driven | `tools/global-vitest-teardown.ts` (sibling NEW file) | partial |
| MODIFY `apps/api/src/email.ts` | service | n/a | becomes a re-export shim from `packages/email` (or delete) | exact (move) |

> **Important correction surfaced during mapping:** `apps/api/vitest.setup.ts` does **not** exist in the current tree — `apps/api/vitest.config.ts` (lines 1–41 reviewed) does not reference a `setupFiles` entry. The planner must treat the SIGINT/SIGTERM hook as **NEW** content, either added as a new `apps/api/vitest.setup.ts` AND wired into `apps/api/vitest.config.ts` `test.setupFiles`, OR folded into the new `tools/global-vitest-teardown.ts` referenced via root `vitest.config.ts` (root config not inspected here — planner should resolve).

---

## Pattern Assignments

### `packages/email/src/EmailSender.ts` (service, request-response)

**Analog:** `apps/api/src/email.ts` (lines 1–105 — verbatim extract target per D-06)

**Imports pattern** (lines 27–28):

```typescript
import nodemailer, { type Transporter } from "nodemailer";
import type { FastifyBaseLogger } from "fastify";
```

> **Planner note:** Drop the `FastifyBaseLogger` dependency in the shared package — the worker uses `pino`, not Fastify's logger wrapper. Replace with a structural `Logger` interface (`{ info, warn, error }`) so both `apps/api` (Fastify) and `apps/worker` (pino) can pass their own logger without coupling the package to Fastify.

**Public interfaces** (lines 30–44):

```typescript
export interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
export interface SendResult {
  delivered: boolean;
  reason?: string;
}
export interface EmailService {
  send(args: SendArgs): Promise<SendResult>;
}
```

> **Planner note:** Rename `EmailService` → `EmailSender` so the shared package matches the `EmailSender` interface already declared at `apps/worker/src/jobs/email-delivery.ts:47`. Existing `apps/worker/src/index.ts:43` (`import { ..., type EmailSender } from "./jobs/email-delivery.js"`) keeps its local re-export; the runtime factory comes from `@openwhispr/email`.

**Dev-fallback pattern** (lines 46–67) — **TO BE REPLACED**:

```typescript
if (!host) {
  log.warn({ event: "email.smtp_not_configured" }, "...");
  return { async send({ to, subject }) { ... return { delivered: true, reason: "smtp-not-configured" }; } };
}
```

> **Critical change per D-07 (loud-fail in production):** retain the dev-fallback ONLY when `NODE_ENV !== "production"`. In production with `!process.env.SMTP_HOST`, **throw at construction**:
>
> ```typescript
> if (!host) {
>   if (process.env.NODE_ENV === "production") {
>     throw new Error("SMTP_HOST is required in production (event:email.smtp_required_in_production)");
>   }
>   log.warn({ event: "email.smtp_not_configured" }, "...");
>   return { async send({ to, subject }) { ... } };
> }
> ```

**Real-SMTP transport pattern** (lines 69–80):

```typescript
const port = Number(process.env.SMTP_PORT ?? "587");
const user = process.env.SMTP_USER;
const password = process.env.SMTP_PASSWORD;
const auth = user && password ? { user, pass: password } : undefined;
const transporter: Transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth,
});
```

> Per D-07 add `SMTP_SECURE` and `SMTP_REJECT_UNAUTHORIZED` env reads (overriding the port-derived default and the TLS strictness). Match the existing port-derived `secure: port === 465` only when `SMTP_SECURE` is unset.

**Error handling pattern** (lines 82–104) — **copy verbatim**:

```typescript
try {
  const info = await transporter.sendMail({ from, to, subject, text, html });
  log.info({ to, subject, messageId: info.messageId, event: "email.sent" }, "email sent");
  return { delivered: true };
} catch (err) {
  // Pitfall #4: NEVER swallow. Better Auth must see the rejection so the
  // verification record stays unverified.
  log.error({ err, to, subject, event: "email.failed" }, "email send failed");
  throw err;
}
```

---

### `packages/email/src/EmailSender.test.ts` (test, unit)

**Analog:** `apps/api/src/email.test.ts` (lines 1–80+ — copy verbatim, adjust import path)

**`nodemailer` mock pattern** (lines 16–26):

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
  createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
}));
```

**Env-cleanup pattern** (lines 43–55):

```typescript
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  sendMailMock.mockReset();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  // ... etc.
});
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });
```

> **Planner note:** Add one NEW test for the production loud-fail branch (`NODE_ENV=production` + `SMTP_HOST` unset → `expect(() => makeEmailSender(...)).toThrow(/email.smtp_required_in_production/)`).

---

### `packages/email/package.json` (config)

**Analog:** `packages/litellm-client/package.json` (verbatim shape)

```json
{
  "name": "@openwhispr/email",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "nodemailer": "<version from root>" },
  "devDependencies": { "vitest": "4.1.5", "@types/nodemailer": "...", "typescript": "^5.6.0", "@types/node": "^22.0.0" }
}
```

### `packages/email/tsconfig.json` (config)

**Analog:** `packages/litellm-client/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"],
  "compilerOptions": { "outDir": "./dist" }
}
```

### `packages/email/vitest.config.ts` (config)

**Analog:** `packages/litellm-client/vitest.config.ts` — copy verbatim (only `include: ["src/**/*.ts"]` + 90/90/90/90 thresholds).

---

### `tools/lint-weak-assertions.ts` (utility, batch)

**Analog:** `tools/lint-english.ts` (lines 1–157 — full skeleton)

**File-scanning skeleton** (lines 29–50):

```typescript
import { readFileSync, realpathSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { exit } from "node:process";

const PATTERNS = ["**/*.test.ts", "**/*.test.tsx"];  // narrow to test files
const IGNORE = ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/.git/**"];
```

**Offender shape + main loop** (lines 82–138) — **copy verbatim, swap regex + patterns**:

```typescript
interface Offender { file: string; line: number; col: number; preview: string; }

const WEAK_ASSERTION = /\.getAllBy\w+\([^)]*\)\.length\.toBeGreaterThan(OrEqual)?\(\s*0\s*\)/;
// Plus the family: .queryAllByText(...).length.toBeGreaterThan(0), etc.

async function main(): Promise<void> {
  const rawCwd = process.argv[2] ?? process.cwd();
  const cwd = resolve(rawCwd);
  const offenders: Offender[] = [];
  // ... same glob walk, line-by-line scan, push offenders, exit(1) if any
}
```

**Exit-code contract** (lines 140–151) — **copy verbatim**:

```typescript
if (offenders.length > 0) {
  process.stderr.write(`Weak-assertion violation: ${offenders.length} occurrence(s)...\n`);
  for (const o of offenders) {
    process.stderr.write(`  ${o.file}:${o.line}:${o.col}  ${o.preview}\n`);
  }
  exit(1);
}
```

**`--self-test` flag** (NEW — required by VALIDATION.md task 13-01-03):
Add a small self-test mode that exercises the regex against an inlined fixture string and exits 0/1 based on detection. Pattern: `if (process.argv.includes("--self-test")) { runSelfTest(); }`.

---

### `tools/lint-weak-assertions.test.ts` (test, unit)

**Analog:** `tools/lint-english.test.ts` (lines 1–60)

**Test-via-execFileSync pattern**:

```typescript
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "tools", "lint-weak-assertions.ts");

function runLint(rootDir: string) {
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT, rootDir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (err: unknown) { /* ... */ }
}

describe("lint-weak-assertions.ts", () => {
  it("exits 0 on a clean tree", () => { ... });
  it("flags getAllByText(...).length.toBeGreaterThan(0)", () => { ... });
  it("flags .toBeGreaterThanOrEqual(2) family per CONTEXT D-12", () => { ... });
});
```

---

### `tools/lint-cjm-doc.ts` (utility, batch — markdown parse)

**Analog:** `tools/lint-docs-headings.ts` (lines 1–50)

**Required-section validation pattern** (lines 27–40):

```typescript
const REQUIRED_DECISIONS = ["wordsUsed semantics", ...] as const;
// For CJM: enforce that each @cjm-N.M anchor with a 2xx outcome has a sibling negative-twin entry.
```

> **Planner note:** This tool has TWO modes (per D-10):
>
> 1. Validate `docs/customer-journeys.md` shape: every `@cjm-N.M` anchor exists, every happy `@cjm-N.M` has a paired negative-twin `@cjm-N.M+x`.
> 2. Validate `.feature` files: every `Scenario:` with a `@cjm-N.M` tag has a matching `docs/customer-journeys.md §N.M` anchor (cross-file).
>
> Mode 2 only runs when `.feature` files exist (13.b territory) — gate with an arg flag (`--features`) so 13.a Wave 0 only enforces mode 1.

---

### `tools/global-vitest-teardown.ts` (utility, test infra)

**Analog (partial):** `tests/e2e/helpers/phase6-compose.ts` (testcontainers cleanup at module scope — lines 53–54, 216–218, 275; references the `DockerComposeEnvironment` and ryuk cleanup posture)

**Pattern:** vitest 4 `globalTeardown` export shape (RESEARCH.md §"testcontainers leak fix" lines 459–525 is authoritative).

```typescript
// SPDX-License-Identifier: Apache-2.0
// Phase 13 — vitest globalTeardown hook + SIGINT/SIGTERM safety net.
// Closes deferred-items.md §1 (testcontainers leak).
import { execFileSync } from "node:child_process";

export default async function globalTeardown(): Promise<void> {
  try {
    execFileSync("docker", [
      "container", "prune", "-f",
      "--filter", "label=org.testcontainers=true",
    ], { stdio: "inherit" });
  } catch { /* CI environments without docker: noop */ }
}

// SIGINT/SIGTERM hook — installs once per process, idempotent.
let installed = false;
export function installSignalHook(): void {
  if (installed) return;
  installed = true;
  const handler = (sig: string) => {
    try { execFileSync("docker", ["container", "prune", "-f", "--filter", "label=org.testcontainers=true"]); } catch {}
    process.exit(sig === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
}
```

> Wire into root `vitest.config.ts` via `test.globalTeardown: ["./tools/global-vitest-teardown.ts"]`. `apps/api/vitest.setup.ts` (NEW file) calls `installSignalHook()` from this module — same approach for any package that boots testcontainers (today only `apps/api/src/__tests__/rate-limit-valkey-construction.test.ts`).

---

### `.github/workflows/e2e-cjm.yml` (config, CI)

**Analog:** `.github/workflows/ci.yml` lines 385–432 (job `e2e-hermetic` — **independent compose boot**, per user choice in CONTEXT.md)

**Job skeleton (lines 390–432 verbatim, swap `make e2e-hermetic` → `make e2e-cjm`):**

```yaml
e2e-cjm:
  runs-on: ubuntu-24.04
  needs: [lint, typecheck, test]
  timeout-minutes: 25
  if: github.event_name == 'pull_request' || github.event_name == 'push'
  env:
    E2E_CJM: "1"
  steps:
    - uses: step-security/harden-runner@a5ad31d6a139d249332a2605b85202e8c0b78450  # v2.19.1
      with: { egress-policy: audit }
    - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd  # v5
      with: { fetch-depth: 0 }
    - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1  # v4
      with: { version: 11.0.8 }
    - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444  # v5
      with: { node-version: '24', cache: 'pnpm' }
    - run: pnpm install --frozen-lockfile
    - name: Install Playwright Chromium
      run: pnpm exec playwright install --with-deps chromium
    - name: Bootstrap fixture .env
      run: |
        cp .env.example .env
        if [ -x tools/bootstrap.sh ]; then tools/bootstrap.sh --ci || true; fi
    - name: Add /etc/hosts entries for *.localhost
      run: echo "127.0.0.1 app.localhost api.localhost auth.localhost mailpit.localhost" | sudo tee -a /etc/hosts
    - name: Build api + migrate + worker images
      run: docker compose build api migrate worker
    - name: Run e2e-cjm
      run: make e2e-cjm
    - name: Capture compose logs on failure
      if: failure()
      run: docker compose logs --no-color > compose-logs-e2e-cjm.txt
    - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02  # v4
      if: failure()
      with: { name: compose-logs-e2e-cjm, path: compose-logs-e2e-cjm.txt }
    - name: Prune testcontainers (D-12 / E2E-08 / E2E-12)
      if: always()
      run: docker container prune -f --filter "label=org.testcontainers=true" || true
    - name: Tear down compose stack
      if: always()
      run: docker compose down -v --remove-orphans || true
```

> Two new pieces vs `e2e-hermetic`: (1) explicit `playwright install --with-deps chromium`; (2) `docker container prune --filter label=org.testcontainers=true` in `always()` (closes the testcontainers-leak deferred item per D-12 / E2E-08).

---

### `Makefile` target `e2e-cjm` (config, build)

**Analog:** `Makefile` lines 249–253 (`e2e-hermetic` target) AND lines 279–298 (`e2e-test-phase6` for the E2E=1 guard pattern)

**Pattern:**

```makefile
# Phase 13 — Cucumber + playwright-bdd E2E + CJM harness.
# Independent compose boot (NOT reusing e2e-hermetic's stack), per CONTEXT D-04.
# Boots default profile, waits on readiness probes (NOT `--wait` liveness),
# runs bddgen → playwright test --grep-invert "@expected-red", tears down.
e2e-cjm:
	@if [ "$$E2E_CJM" != "1" ]; then \
	  echo "Refusing to run: E2E_CJM=1 required." ; \
	  echo "Usage: E2E_CJM=1 make e2e-cjm" ; \
	  exit 1 ; \
	fi
	@test -f .env || (echo "Refusing to run: .env not found. Run tools/bootstrap.sh first." && exit 1)
	docker compose --profile default up -d
	E2E_CJM=1 pnpm exec tsx tests/e2e-cjm/support/wait-for-readiness.ts
	E2E_CJM=1 pnpm exec bddgen
	E2E_CJM=1 NODE_TLS_REJECT_UNAUTHORIZED=0 \
	  pnpm exec playwright test --config tests/e2e-cjm/playwright.config.ts \
	    --grep-invert "@expected-red" \
	    $${SCENARIO:+--grep "$${SCENARIO}"} ; \
	rc=$$? ; \
	docker compose down -v --remove-orphans ; \
	docker container prune -f --filter "label=org.testcontainers=true" ; \
	exit $$rc
```

> Note the `$${SCENARIO:+--grep ...}` pattern — VALIDATION task 13-01-05/06 invokes `make e2e-cjm SCENARIO=@cjm-1.1`.

Also append `e2e-cjm` to the `.PHONY` list (Makefile line 5).

---

### `tests/e2e-cjm/support/compose-harness.ts` (utility, test infra)

**Analog:** `tests/e2e/compose-helper.ts` (lines 1–100 — `BACKEND_URL`, `HERMETIC_ENV`, `run()`, `compose()`, `bringStackUp()`)

**Core pattern (lines 14–65) — wrap, don't replace:**

```typescript
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

export const BASE_URL = "https://app.localhost";
export const API_URL = "https://api.localhost";
export const MAILPIT_API = "http://localhost:8025/api/v1";

export async function bootStack(): Promise<void> {
  // Per CONTEXT integration-points note: pass --profile default explicitly
  // to work around TD-14.f (compose profiles: [default] selecting zero services).
  const code = await compose("--profile", "default", "up", "-d");
  if (code !== 0) throw new Error(`compose up failed: ${code}`);
  await waitForReadiness();
}
```

**Readiness-probe contract** (RESEARCH.md §"Readiness probes contract" — Pitfall 5):

```typescript
async function waitForReadiness(): Promise<void> {
  // 1. Postgres: SELECT 1
  // 2. Fastify GET /api/health → 200 AND migrations_completed=true
  // 3. Mailpit GET /api/v1/messages → 200
  // 4. Web GET / → 200
  // Exponential backoff, hard cap 90s, throw on timeout (NO retry loop in suite).
}
```

---

### MODIFY `apps/worker/src/index.ts` lines 66–134 (controller, process entry)

**Self-analog:** lines 68–72 (current `noopSender` const declaration) and line 130 (`sender: noopSender` wiring).

**Replacement (atomic, single commit per D-04):**

```typescript
// REMOVE lines 66-72:
// const noopSender: EmailSender = {
//   async send() { return { delivered: true, reason: "no-op-sender" }; },
// };

// ADD import at top:
import { createEmailSender } from "@openwhispr/email";

// ADD before main():
const realSender: EmailSender = createEmailSender({ log, env: process.env });
// (Loud-fails at module init in production if SMTP_HOST unset — per D-07.)

// REPLACE line 130:
const emailWorker = new Worker(
  QUEUE_NAMES.emailDelivery,
  buildEmailDeliveryHandler({
    pool: appOwnerPool,
    sender: realSender,           // was: noopSender
    renderer: templateRenderer,
  }),
  { connection },
);
```

> **Atomic-commit nuance (D-04):** This file MUST land in the SAME commit as `packages/email/` AND the harness scaffold. The planner cannot stagger across plan-wave boundaries.

---

### MODIFY `apps/api/src/email.ts` (service)

**Self-analog:** the entire file is moved verbatim into `packages/email/src/EmailSender.ts`.

**Two acceptable outcomes (researcher said "verbatim move + env loud-fail gate"):**

1. **Delete `apps/api/src/email.ts`** + update all importers (use Grep: `grep -rn "from .*api/src/email" apps/api/src/`) to import from `@openwhispr/email`.
2. **Leave as re-export shim:**
   ```typescript
   // SPDX-License-Identifier: Apache-2.0
   // Phase 13 — moved to packages/email. Shim kept for transitional importers.
   export { createEmailSender as makeEmailService } from "@openwhispr/email";
   export type { SendArgs, SendResult, EmailSender as EmailService } from "@openwhispr/email";
   ```

> Planner chooses based on importer count; option (1) is cleaner if importer count ≤ 5.

---

### MODIFY `apps/api/src/routes/health.ts` (controller, request-response)

**Self-analog:** lines 15–22 (current handler returns `{ status: "ok" }`).

**User-decided change (CONTEXT "Verify in planning"):** Add `migrations_completed` field. Verify first whether the `HealthResponse` schema in `@openwhispr/contract-tests/schemas` permits the extra field (open-shape vs strict).

```typescript
handler: async () => ({
  status: "ok" as const,
  migrations_completed: await checkMigrationsCompleted(),  // NEW
}),
```

> `checkMigrationsCompleted()` queries `_meta.__drizzle_migrations` — pattern lives in `tools/lint-rls.ts` lines 154–157 (`new Client({ connectionString }).connect()`). Reuse the same connection pattern but via the existing api pool, not a one-shot client.

> **Schema-evolution gate:** Any change to `HealthResponse` ALSO requires updates to `packages/contract-tests/schemas/` AND every conformance fixture that asserts byte-for-byte equality (CONTEXT canonical-refs §"wire compatibility"). Planner must scope this as a 3-file edit, not 1.

---

### MODIFY `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx` (test, component)

**Self-analog:** lines 130–189 (3 weak-assertion sites at 147, 165, 186).

**Replacement pattern** (RESEARCH.md §"Replacement guidance"):

```typescript
// BEFORE (line 147):
expect(screen.getAllByText(/already registered/i).length).toBeGreaterThan(0);

// AFTER:
expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
// OR (if multiple matches are semantically expected):
expect(screen.getAllByText(/already registered/i)).toHaveLength(1);
```

> Use `findByText` (auto-waits) over `getAllByText` + `toHaveLength` where the assertion is "exactly one element exists eventually" — that's the case for all 3 sites in `SignUpForm.test.tsx`.

### MODIFY `apps/web/src/components/screens/notes/__tests__/NoteDetailClient.test.tsx` (2 sites: lines 360, 370)

Same pattern. Both assert on the em-dash placeholder; rewrite to `toHaveLength(N)` where N is the actual count expected (planner reads context per site).

### MODIFY `apps/web/src/components/screens/notes/__tests__/NotesListClient.test.tsx` (4 sites: lines 127, 166, 276, 295)

Site 166 already uses `toBeGreaterThanOrEqual(2)` — per CONTEXT's weak-assertion ban this is **also** banned. Rewrite to `toHaveLength(2)` (the test data has exactly 2 "Work" labels).

---

## Shared Patterns

### Tool-shebang convention (apply to all NEW `tools/lint-*.ts`)

**Source:** `tools/lint-english.ts` line 1, `tools/lint-rls.ts` line 1
**Apply to:** `tools/lint-weak-assertions.ts`, `tools/lint-cjm-doc.ts`

```typescript
#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: Apache-2.0
```

### Lint exit-code contract

**Source:** `tools/lint-english.ts` lines 140–151, `tools/lint-rls.ts` lines 241–250
**Apply to:** both new lint tools

| Code | Meaning |
|------|---------|
| 0 | no offenders |
| 1 | at least one offender; printed to stderr as `file:line:col message` |
| 2 | internal error |

### Shared-package shape

**Source:** `packages/litellm-client/{package.json,tsconfig.json,vitest.config.ts}` + `packages/observability/package.json`
**Apply to:** `packages/email/`

- `"name": "@openwhispr/<name>"`, `"private": true`, `"type": "module"`
- `"main": "./src/index.ts"`, `"exports": { ".": "./src/index.ts" }`
- vitest.config.ts narrows include to `src/**/*.ts` + 90/90/90/90 thresholds (merged with root)
- tsconfig.json extends `../../tsconfig.base.json`

### Pino-vs-Fastify logger abstraction (NEW pattern; needed for shared package)

When extracting `apps/api/src/email.ts` (which depends on `FastifyBaseLogger`) into a package consumed by both `apps/api` (Fastify) and `apps/worker` (pino), introduce a structural `Logger` interface in the shared package:

```typescript
export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}
```

Both `FastifyBaseLogger` and `pino.Logger` structurally satisfy this — no adapter needed at call sites.

### English-only artifact rule

**Source:** project CLAUDE.md hard rule + `tools/lint-english.ts`
**Apply to:** every NEW file. Especially relevant for `docs/customer-journeys.md` (i18n surface allowance does NOT apply to source artifacts).

### Retry-banned in CI (D-12 / Pitfall 5)

**Source:** RESEARCH.md PITFALLS Pitfall 5
**Apply to:** `playwright.config.ts` (`retries: 0`), `bddgen.config.ts` / Cucumber config (`retry: 0`), `make e2e-cjm` Makefile target (no retry loops).

### Env-switch escape-hatch posture (Phase 07.1 D-01)

**Source:** existing `OPENWHISPR_DISABLE_RATE_LIMIT`, `OPENWHISPR_TEST_ROUTES`, `MOCK_DIARIZATION`
**Apply to:** any NEW Phase 13 test-mode flag. Default OFF in prod; loud-fail at boot if the flag is on AND `NODE_ENV === "production"`.

---

## No Analog Found

| File | Role | Data Flow | Reason | Planner Source |
|------|------|-----------|--------|----------------|
| `tests/e2e-cjm/features/*.feature` | test (Gherkin) | event-driven | No Cucumber/Gherkin in repo today | RESEARCH.md §"Cucumber + playwright-bdd: chosen patterns" lines 217–293 |
| `tests/e2e-cjm/steps/*.steps.ts` | test (Cucumber steps) | event-driven | No playwright-bdd patterns in repo | RESEARCH.md §"Sharing Playwright page between steps" lines 261–281 |
| `tests/e2e-cjm/playwright.config.ts` | config | n/a | `@playwright/test 1.59.1` is in repo but no `playwright.config.ts` exists | RESEARCH.md §"File layout" lines 221–249 |
| `tests/e2e-cjm/bddgen.config.ts` | config | n/a | `playwright-bdd` is new dep | playwright-bdd 8.4.2 official docs (RESEARCH.md §"File layout") |
| `tests/e2e-cjm/support/mailpit-helper.ts` | utility (HTTP poll) | request-response | Mailpit HTTP API not currently consumed | Mailpit `/api/v1/messages` docs (CONTEXT integration-points) |
| `apps/api/vitest.setup.ts` | utility (test infra) | event-driven | Does not currently exist (verified by `find apps/api -name "vitest.setup*"` → no match) — treat as NEW, not MODIFY | `tools/global-vitest-teardown.ts` (sibling) + vitest 4 `globalSetup`/`setupFiles` docs |

---

## Discrepancies Found vs Upstream Context

The pattern-mapping pass surfaced two corrections the planner must absorb:

1. **`apps/api/vitest.setup.ts` does not exist.** Upstream `<files_to_create>` marks it as MODIFY, but `find apps/api -name "vitest.setup*"` returns no match and `apps/api/vitest.config.ts` (read) does not reference a setupFiles entry. Treat as a NEW file requiring wiring into `apps/api/vitest.config.ts`'s `test.setupFiles`.

2. **`apps/api/src/health.ts` does not exist; the actual route lives at `apps/api/src/routes/health.ts`.** Upstream `<files_to_create>` references `apps/api/src/health.ts`. The `migrations_completed` field belongs in `apps/api/src/routes/health.ts:15–22`. Schema lives in `@openwhispr/contract-tests/schemas` and must be updated in the same commit (wire-compat invariant per CLAUDE.md).

3. **`apps/api/src/email.ts` env-var name mismatch.** The current file (line 71) uses `process.env.SMTP_PASSWORD`. CONTEXT D-07 specifies `SMTP_PASS`. Planner must pick one — recommend keeping `SMTP_PASSWORD` (it's the existing wired contract) and updating CONTEXT/RESEARCH downstream, OR adding both with `SMTP_PASS ?? SMTP_PASSWORD` for backward-compat.

---

## Metadata

**Analog search scope:** `tools/`, `apps/api/src/`, `apps/worker/src/`, `apps/web/src/components/screens/`, `packages/{observability,litellm-client}/`, `tests/e2e/`, `.github/workflows/`, `Makefile`

**Files scanned (Read in full or in part):** 14 — `apps/api/src/email.ts`, `apps/api/src/email.test.ts`, `apps/worker/src/index.ts`, `apps/worker/src/jobs/email-delivery.ts`, `tools/lint-english.ts`, `tools/lint-english.test.ts`, `tools/lint-rls.ts`, `tools/lint-docs-headings.ts`, `apps/api/src/routes/health.ts`, `apps/api/vitest.config.ts`, `packages/observability/package.json`, `packages/litellm-client/{package.json,tsconfig.json,vitest.config.ts}`, `tests/e2e/compose-helper.ts`, `.github/workflows/ci.yml`, `Makefile`, `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx`

**Pattern extraction date:** 2026-05-14
