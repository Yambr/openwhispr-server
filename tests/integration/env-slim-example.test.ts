// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 14 / Plan 02 / Task 2 — `.env.slim.example` conformance.
 *
 * Asserts the byte-level contract of the slim-core operator env template
 * from `14-CONTEXT.md` decision 4, `14-RESEARCH-env-slim.md` section
 * "Concrete proposal", and the 9-behavior list in `14-02-PLAN.md`. The
 * pre-existing 90-key monolithic template lives at `.env.full.example`
 * (renamed from `.env.example`) and is kept as a complete reference.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");
const SLIM_PATH = join(REPO_ROOT, ".env.slim.example");
const FULL_PATH = join(REPO_ROOT, ".env.full.example");
const LEGACY_PATH = join(REPO_ROOT, ".env.example");

/**
 * Parse a dotenv-shaped string into {KEY: VALUE} for UNCOMMENTED rows.
 * Lines beginning with `#` (after leading whitespace) are skipped — they
 * are the overlay-section banners and inline docs, not active env.
 * Blank lines and rows lacking `=` are skipped silently.
 */
function parseActiveKeys(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trimStart();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    out.set(key, line.slice(eq + 1));
  }
  return out;
}

const slimText = existsSync(SLIM_PATH) ? readFileSync(SLIM_PATH, "utf8") : "";

describe("Phase 14 / Plan 02 — .env.slim.example conformance", () => {
  it("Test 1: `.env.slim.example` exists at repo root", () => {
    expect(existsSync(SLIM_PATH), `expected ${SLIM_PATH} to exist`).toBe(true);
  });

  it("Test 2: `.env.full.example` exists; `.env.example` was renamed (does NOT exist)", () => {
    expect(existsSync(FULL_PATH), `expected ${FULL_PATH} to exist (rename target)`).toBe(true);
    expect(existsSync(LEGACY_PATH), `legacy ${LEGACY_PATH} must not exist after rename`).toBe(
      false,
    );
  });

  it("Test 3: uncommented keys are exactly the current slim contract", () => {
    // The slim contract grew past the original 11 keys as later phases
    // landed: R19 added the verification-email origin facet
    // (INGRESS_BASE_URL / AUTH_URL / OPENWHISPR_API_URL — the
    // externally-reachable origin a mail client can resolve), the
    // operator-owned realtime alias (LITELLM_REALTIME_MODEL), and the
    // dev-profile SMTP block (mailpit was promoted into the slim base
    // behind the `dev` compose profile). Each addition is documented
    // inline in `.env.slim.example`; the file is the source of truth.
    const expectedKeys = [
      // 5 user-visible mandatory inputs (CONTEXT decision 4)
      "POSTGRES_APP_PASSWORD",
      "BETTER_AUTH_SECRET",
      "LITELLM_MASTER_KEY",
      "BETTER_AUTH_URL",
      "OPENROUTER_API_KEY",
      // 4 bootstrap-invisible secrets (RESEARCH section D.2)
      "POSTGRES_OWNER_PASSWORD",
      "VALKEY_PASSWORD",
      "MASTER_KEK",
      "BACKUP_AGE_IDENTITY",
      // OTel disable sentinel (CONTEXT decision 5)
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      // Phase 15 / Plan 02 (STRUCT-05) — Better Auth trustedOrigins env
      // extension for split-host dev (web.localhost + api.localhost via
      // Traefik). See apps/api/src/auth.ts trustedOrigins computation.
      "AUTH_TRUSTED_ORIGINS_EXTRA",
      // R19 — externally-reachable API origin facet. Better Auth builds
      // the verification-email link from INGRESS_BASE_URL; AUTH_URL /
      // OPENWHISPR_API_URL feed the CSRF/Origin allow-list.
      "INGRESS_BASE_URL",
      "AUTH_URL",
      "OPENWHISPR_API_URL",
      // D1 — operator-owned server-injected realtime model alias.
      "LITELLM_REALTIME_MODEL",
      // Phase 61 / R19 — dev-profile SMTP block (mailpit promoted into
      // the slim base behind the `dev` compose profile).
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "SMTP_FROM",
    ];
    const active = parseActiveKeys(slimText);
    const actualKeys = [...active.keys()].sort();
    // Derived URLs (DATABASE_URL, VALKEY_URL, LITELLM_BASE_URL) live in a
    // separate "Derived (do not edit)" block and are intentionally NOT
    // counted as input keys — they interpolate via ${VAR}. To keep this
    // assertion strict on the input contract, filter them out before the
    // sort comparison.
    const derived = new Set(["DATABASE_URL", "VALKEY_URL", "LITELLM_BASE_URL"]);
    const inputKeys = actualKeys.filter((k) => !derived.has(k));
    expect(inputKeys.sort()).toEqual([...expectedKeys].sort());
  });

  it("Test 4: the 4 bootstrap-invisible keys carry PLACEHOLDER_BOOTSTRAP_WILL_REPLACE", () => {
    const active = parseActiveKeys(slimText);
    const placeholderKeys = [
      "POSTGRES_OWNER_PASSWORD",
      "VALKEY_PASSWORD",
      "MASTER_KEK",
      "BACKUP_AGE_IDENTITY",
      // The two operator-visible-but-bootstrap-fillable secrets:
      "POSTGRES_APP_PASSWORD",
      "BETTER_AUTH_SECRET",
      "LITELLM_MASTER_KEY",
    ];
    for (const key of placeholderKeys) {
      expect(active.get(key), `${key} value`).toBe("PLACEHOLDER_BOOTSTRAP_WILL_REPLACE");
    }
  });

  it("Test 5: OPENROUTER_API_KEY has empty value (operator-supplied or 503 envelope)", () => {
    const active = parseActiveKeys(slimText);
    expect(active.get("OPENROUTER_API_KEY")).toBe("");
  });

  it("Test 6: BETTER_AUTH_URL defaults to http://localhost:3000", () => {
    const active = parseActiveKeys(slimText);
    expect(active.get("BETTER_AUTH_URL")).toBe("http://localhost:3000");
  });

  it("Test 7: OTEL_EXPORTER_OTLP_ENDPOINT defaults to the `disabled` sentinel (CONTEXT decision 5)", () => {
    const active = parseActiveKeys(slimText);
    expect(active.get("OTEL_EXPORTER_OTLP_ENDPOINT")).toBe("disabled");
  });

  // Phase 61 / R19 — the `dev-tools` overlay no longer owns mailpit/SMTP
  // (promoted into the slim base behind the `dev` compose profile), so the
  // slim template no longer carries a `dev-tools` REQUIRES banner. The
  // opt-in overlays the template documents are: storage, observability,
  // ingress, pgbouncer, and contract-test.
  it("Test 8: contains a `# REQUIRES: docker-compose.<overlay>.yml` banner for each opt-in overlay", () => {
    const overlays = ["observability", "storage", "ingress", "pgbouncer", "contract-test"];
    for (const overlay of overlays) {
      const banner = `# REQUIRES: compose/docker-compose.${overlay}.yml`;
      expect(slimText, `banner for overlay ${overlay}`).toContain(banner);
    }
  });

  it("Test 9: each overlay section contains its expected commented BYOK env keys", () => {
    // Helper: find the slice of slimText starting at the overlay banner up
    // to (but not including) the next overlay banner or EOF. Asserting on
    // the slice lets us catch a key placed in the wrong section.
    function sliceForOverlay(overlay: string): string {
      const banner = `# REQUIRES: compose/docker-compose.${overlay}.yml`;
      const idx = slimText.indexOf(banner);
      expect(idx, `banner for ${overlay} located`).toBeGreaterThanOrEqual(0);
      // Next overlay banner OR end-of-file.
      const rest = slimText.slice(idx + banner.length);
      const nextBannerIdx = rest.indexOf("# REQUIRES: compose/docker-compose.");
      return nextBannerIdx === -1 ? rest : rest.slice(0, nextBannerIdx);
    }

    // The contract-test overlay carries NO BYOK env keys — it is
    // self-contained (fixture-idp + seed + contract-test-runner). It is
    // still listed so Test 9 asserts its banner exists with an empty key
    // set rather than silently skipping it.
    const expectations: Record<string, string[]> = {
      storage: ["S3_ENDPOINT=", "S3_ACCESS_KEY=", "S3_SECRET_KEY=", "S3_BUCKET="],
      observability: ["OTEL_EXPORTER_OTLP_ENDPOINT=", "OTEL_SERVICE_NAME="],
      ingress: ["INGRESS_BASE_URL=", "TRAEFIK_ADMIN_PASSWORD="],
      pgbouncer: ["PGBOUNCER_ADMIN_PASSWORD="],
      "contract-test": [],
    };

    for (const [overlay, keys] of Object.entries(expectations)) {
      const section = sliceForOverlay(overlay);
      for (const key of keys) {
        // The overlay rows are COMMENTED out (operator uncomments to enable);
        // assert the `# <KEY>=` form exists. Whitespace between `#` and key
        // is tolerated.
        const pattern = new RegExp(
          `^\\s*#\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`,
          "m",
        );
        expect(section, `overlay ${overlay} carries commented ${key}`).toMatch(pattern);
      }
    }
  });

  it("Test 10 (well-formedness): every overlay-appendix line is either blank, a comment, or PARSEABLE active env", () => {
    // Catches the "orphan `#KEY` glued to its value with no space" pitfall
    // called out in the plan's optional vitest check. Any line that looks
    // like KEY=VALUE without a leading `#` MUST be one of the 10 active keys
    // or one of the 3 derived keys; everything else inside the overlay
    // appendix MUST be a comment or blank.
    const allowedActive = new Set([
      "POSTGRES_APP_PASSWORD",
      "BETTER_AUTH_SECRET",
      "LITELLM_MASTER_KEY",
      "BETTER_AUTH_URL",
      "OPENROUTER_API_KEY",
      "POSTGRES_OWNER_PASSWORD",
      "VALKEY_PASSWORD",
      "MASTER_KEK",
      "BACKUP_AGE_IDENTITY",
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "AUTH_TRUSTED_ORIGINS_EXTRA",
      // R19 — externally-reachable API origin facet.
      "INGRESS_BASE_URL",
      "AUTH_URL",
      "OPENWHISPR_API_URL",
      // D1 — operator-owned realtime model alias.
      "LITELLM_REALTIME_MODEL",
      // Phase 61 / R19 — dev-profile SMTP block.
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "SMTP_FROM",
      // Derived (do not edit) — ${VAR}-interpolated.
      "DATABASE_URL",
      "VALKEY_URL",
      "LITELLM_BASE_URL",
    ]);
    for (const raw of slimText.split("\n")) {
      const line = raw.replace(/\r$/, "");
      const trimmed = line.trimStart();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) {
        // Any non-blank non-comment line MUST contain `=`.
        expect.fail(`Malformed slim line (no '='): ${JSON.stringify(line)}`);
      }
      const key = line.slice(0, eq).trim();
      expect(
        allowedActive.has(key),
        `Active key ${key} not in allowlist; either move under # comment or whitelist it`,
      ).toBe(true);
    }
  });
});
