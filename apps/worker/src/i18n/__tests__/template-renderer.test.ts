// Phase 10 / Plan 10-01b — Worker TemplateRenderer (RED → GREEN).
//
// Contract:
//   - Synchronous render(templateId, locale, variables) — matches the
//     TemplateRenderer interface in apps/worker/src/jobs/email-delivery.ts
//     (Phase 6 Plan 06-08, advisor B3 in 10-01-PLAN.md).
//   - Subject/text/html loaded from on-disk template files at module init
//     (constructor) via fs.readFileSync.
//   - Cyrillic isolated to apps/worker/src/i18n/locales/ru/email/**.
//
// The renderer is the only worker-side i18n surface in 10-01b. Plan
// 10-01c will wire the API → worker queue with the per-user locale; this
// suite locks the rendering shape so 10-01c can rely on it.

import { describe, expect, it } from "vitest";
import { createTemplateRenderer, UnknownTemplateError } from "../template-renderer.js";

const VERIFY_VARS = { name: "Sam", verification_url: "https://example.com/v?t=abc" };
const RESET_VARS = { name: "Sam", reset_url: "https://example.com/r?t=abc", expires_minutes: 30 };
const DELETE_VARS = { name: "Sam", deleted_at: "2026-05-13T12:00:00Z" };

const CYRILLIC = /[Ѐ-ӿ]/;

describe("TemplateRenderer", () => {
  const renderer = createTemplateRenderer();

  it("exposes the three production template ids", () => {
    expect([...renderer.knownTemplateIds].sort()).toEqual([
      "account_deletion_confirmation",
      "email_verification",
      "password_reset",
    ]);
  });

  it("renders email_verification (en) with interpolated variables", () => {
    const r = renderer.render("email_verification", "en", VERIFY_VARS);
    expect(r.subject).toMatch(/Verify your OpenWhispr email address/);
    expect(r.text).toContain("Hello Sam,");
    expect(r.text).toContain("https://example.com/v?t=abc");
    expect(r.html).toBeDefined();
    expect(r.html ?? "").toContain("https://example.com/v?t=abc");
    // English bundle must NOT carry Cyrillic.
    expect(CYRILLIC.test(r.subject + r.text + (r.html ?? ""))).toBe(false);
  });

  it("renders email_verification (ru) with Cyrillic + formal вы-form", () => {
    const r = renderer.render("email_verification", "ru", VERIFY_VARS);
    expect(CYRILLIC.test(r.subject)).toBe(true);
    expect(r.text).toMatch(/Здравствуйте, Sam!/);
    expect(r.text).toContain("https://example.com/v?t=abc");
    expect(r.text).toContain("С уважением");
    expect(r.html).toBeDefined();
    expect(r.html ?? "").toContain("Здравствуйте");
  });

  it("renders password_reset (en) with expires_minutes interpolation", () => {
    const r = renderer.render("password_reset", "en", RESET_VARS);
    expect(r.subject).toMatch(/Reset your OpenWhispr password/);
    expect(r.text).toContain("30 minutes");
    expect(r.text).toContain("https://example.com/r?t=abc");
    expect(r.text).toContain("Hello Sam,");
  });

  it("renders password_reset (ru) with Cyrillic + interpolated minutes", () => {
    const r = renderer.render("password_reset", "ru", RESET_VARS);
    expect(CYRILLIC.test(r.subject)).toBe(true);
    expect(r.text).toContain("30 минут");
    expect(r.text).toContain("https://example.com/r?t=abc");
  });

  it("renders account_deletion_confirmation (en)", () => {
    const r = renderer.render("account_deletion_confirmation", "en", DELETE_VARS);
    expect(r.subject).toMatch(/deleted/i);
    expect(r.text).toContain("2026-05-13T12:00:00Z");
    expect(r.text).toContain("Hello Sam,");
  });

  it("renders account_deletion_confirmation (ru) with Cyrillic", () => {
    const r = renderer.render("account_deletion_confirmation", "ru", DELETE_VARS);
    expect(CYRILLIC.test(r.subject)).toBe(true);
    expect(r.text).toContain("2026-05-13T12:00:00Z");
    expect(r.text).toContain("Здравствуйте");
  });

  it("matches the email-delivery TemplateRenderer interface (sync, positional)", async () => {
    // Compile-time check (via the `implements TemplateRendererInterface`
    // clause in template-renderer.ts): createTemplateRenderer() is
    // assignable to the email-delivery TemplateRenderer interface.
    // Runtime: positional 3-arg call returns the expected shape sync.
    const out = renderer.render("email_verification", "en", VERIFY_VARS);
    expect(typeof out.subject).toBe("string");
    expect(typeof out.text).toBe("string");
    expect(out.subject.length).toBeGreaterThan(0);
    expect(out.text.length).toBeGreaterThan(0);
  });

  it("throws UnknownTemplateError for an unregistered template id", () => {
    expect(() => renderer.render("not_a_real_template", "en", {})).toThrow(UnknownTemplateError);
    expect(() => renderer.render("not_a_real_template", "en", {})).toThrow(/not_a_real_template/);
  });

  it("renders every (template_id, locale) pair with non-empty subject+text (completeness)", () => {
    const variablesByTemplate: Record<string, Record<string, unknown>> = {
      email_verification: VERIFY_VARS,
      password_reset: RESET_VARS,
      account_deletion_confirmation: DELETE_VARS,
    };
    for (const id of renderer.knownTemplateIds) {
      for (const locale of ["en", "ru"] as const) {
        const r = renderer.render(id, locale, variablesByTemplate[id] ?? {});
        expect(r.subject.length).toBeGreaterThan(0);
        expect(r.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("leaves unknown `{var}` tokens untouched (loud QA failure mode)", () => {
    const r = renderer.render("email_verification", "en", { verification_url: "URL" });
    // `name` is omitted; the literal `{name}` should remain so QA notices.
    expect(r.text).toContain("{name}");
    expect(r.text).toContain("URL");
  });

  it("coerces non-string variables via String() (e.g. number expires_minutes)", () => {
    const r = renderer.render("password_reset", "en", {
      name: "Sam",
      reset_url: "https://example.com",
      expires_minutes: 0,
    });
    expect(r.text).toContain("0 minutes");
  });

  it("WorkerTemplateRenderer can be constructed with an injected bundle map (DI path)", async () => {
    const { WorkerTemplateRenderer } = await import("../template-renderer.js");
    // Eager construction with a hand-rolled minimal bundle proves the
    // class constructor's bundle param is honoured (covers the default-
    // arg branch on `bundles = loadAll()`).
    const minimal = {
      en: {
        email_verification: { subject: "S-en", text: "T-en {name}" },
        password_reset: { subject: "P-en", text: "P-en", html: "<p>P</p>" },
        account_deletion_confirmation: { subject: "D-en", text: "D-en" },
      },
      ru: {
        email_verification: { subject: "S-ru", text: "T-ru {name}" },
        password_reset: { subject: "P-ru", text: "P-ru" },
        account_deletion_confirmation: { subject: "D-ru", text: "D-ru" },
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: DI shape is internal.
    const r = new WorkerTemplateRenderer(minimal as any);
    const out = r.render("email_verification", "en", { name: "Alex" });
    expect(out.subject).toBe("S-en");
    expect(out.text).toBe("T-en Alex");
    expect(out.html).toBeUndefined();
    // ru locale path:
    const ruOut = r.render("email_verification", "ru", { name: "Alex" });
    expect(ruOut.subject).toBe("S-ru");
    // password_reset has html -> propagated through interpolate.
    const pr = r.render("password_reset", "en", {});
    expect(pr.html).toBe("<p>P</p>");
  });

  it("falls back to English locale for any unsupported value (defensive cast)", async () => {
    // The render() signature only allows "en"|"ru"; this test casts an
    // unsupported locale value at runtime to cover the locale-coerce
    // branch defensively.
    const out = renderer.render(
      "email_verification",
      // biome-ignore lint/suspicious/noExplicitAny: runtime defensive cast
      "fr" as any,
      VERIFY_VARS,
    );
    // Falls back to English (the implementation maps anything !== "ru"
    // to "en").
    expect(out.subject).toMatch(/Verify your OpenWhispr/);
  });

  it("honours LOCALES_DIR env override at construction time", () => {
    // Pointing at a known-bad path causes the constructor to throw —
    // proves the override is consulted (and not a silent ignore).
    const previous = process.env.LOCALES_DIR;
    process.env.LOCALES_DIR = "/nonexistent/openwhispr-locales-test-path";
    try {
      expect(() => createTemplateRenderer()).toThrow();
    } finally {
      if (previous === undefined) delete process.env.LOCALES_DIR;
      else process.env.LOCALES_DIR = previous;
    }
  });
});
