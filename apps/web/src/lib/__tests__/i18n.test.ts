// Phase 07.1 / Plan 06 — i18next server instance tests (RED before GREEN).
//
// RESEARCH § Pattern 6: `getServerI18n(lng, ns)` creates a per-request
// instance (NOT a shared module-level singleton — Pitfall 1 cross-request
// data leak). Verified surface:
//   - t() resolves a known Appendix C key
//   - missing key falls back to the key itself (i18next default)
//   - resourceStore.data is serializable (Pitfall 1 RSC→Client boundary)
import { describe, expect, it } from "vitest";
import { getServerI18n } from "../i18n";

describe("getServerI18n (Phase 07.1 / Plan 06)", () => {
  it("resolves end-user.signin.title.heading.text to the Appendix C value", async () => {
    const i = await getServerI18n("en", ["end-user", "common"]);
    expect(i.t("end-user.signin.title.heading.text", { ns: "end-user" })).toBe(
      "Sign in to OpenWhispr",
    );
  });

  it("resolves admin.observability.title.heading.text", async () => {
    const i = await getServerI18n("en", ["admin", "common"]);
    expect(i.t("admin.observability.title.heading.text", { ns: "admin" })).toBe("Observability");
  });

  it("resolves common.signout.label", async () => {
    const i = await getServerI18n("en", ["common"]);
    expect(i.t("common.signout.label", { ns: "common" })).toBe("Sign out");
  });

  it("returns the key itself for a missing key (i18next default fallback)", async () => {
    const i = await getServerI18n("en", ["end-user", "common"]);
    expect(i.t("end-user.totally.missing.key.text", { ns: "end-user" })).toBe(
      "end-user.totally.missing.key.text",
    );
  });

  it("resourceStore.data is a plain serializable object (RSC→Client boundary)", async () => {
    const i = await getServerI18n("en", ["admin", "end-user", "common"]);
    const snapshot = i.services.resourceStore.data;
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
