// Phase 10 / Plan 10-01b — Worker TemplateRenderer (GREEN).
//
// Responsibilities:
//   1. Load the 3 production email templates × {en, ru} × {subject, text,
//      html} synchronously at construction via fs.readFileSync. Eager
//      load matches the API i18n bootstrap posture (Plan 10-01a): zero
//      IO at render time, deterministic failure-on-boot if a template
//      file is missing.
//   2. Render(templateId, locale, variables) -> {subject, text, html?}.
//      Signature is positional + synchronous to match the existing
//      TemplateRenderer interface in apps/worker/src/jobs/email-delivery.ts
//      (Phase 6 Plan 06-08; advisor B3 in 10-01-PLAN.md). Changing the
//      interface to async/object-arg would ripple into job-handler tests
//      already in tree, so we keep the contract pinned.
//   3. Interpolation is a single-pass `{var}` substitution. The 3
//      templates carry no plural forms or gendered selects, so importing
//      i18next + ICU here would add 200 KB of runtime weight for zero
//      semantic gain. If a future template needs CLDR plurals, swap the
//      interpolator for i18next.t() in place — call sites remain
//      unchanged.
//
// Locale-dir resolution mirrors apps/api/src/i18n/init.ts:
//   1. `LOCALES_DIR` env override (operator docker-compose volume).
//   2. Source-tree path: <here>/locales/<lng>/email/<id>/<file>.
//   3. Dist fallback: <here>/i18n/locales/... (post-tsup-bundle layout —
//      tsup's onSuccess copy step is wired by Plan 10-01d; until then
//      the dev/test path under (2) is what runs).
//
// Cyrillic is isolated to ru template files; the lint-english.ts
// allowlist already covers `**/locales/**` so the bundle is permitted.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TemplateRenderer as TemplateRendererInterface } from "../jobs/email-delivery.js";

const SUPPORTED_LOCALES = ["en", "ru"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const KNOWN_TEMPLATE_IDS = [
  "email_verification",
  "password_reset",
  "account_deletion_confirmation",
] as const;
type TemplateId = (typeof KNOWN_TEMPLATE_IDS)[number];

/** Thrown when render() is called with an id outside KNOWN_TEMPLATE_IDS. */
export class UnknownTemplateError extends Error {
  override readonly name = "UnknownTemplateError";
  constructor(templateId: string) {
    super(`unknown email template id: ${templateId}`);
  }
}

interface LoadedTemplate {
  subject: string;
  text: string;
  html?: string;
}

type LocaleBundle = Record<TemplateId, LoadedTemplate>;
type Bundles = Record<SupportedLocale, LocaleBundle>;

/**
 * Resolve the absolute path of the worker's locales directory. Mirrors
 * apps/api/src/i18n/init.ts:resolveLocalesDir for symmetry.
 */
function resolveLocalesDir(): string {
  const fromEnv = process.env.LOCALES_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  // Source tree: <here>/locales (this module sits at src/i18n/).
  // Post-tsup dist bundle: <here>/i18n/locales (copied by Plan 10-01d).
  try {
    const distLayout = resolve(here, "i18n", "locales");
    readFileSync(resolve(distLayout, "en", "email", "email_verification", "subject.txt"));
    return distLayout;
  } catch {
    return resolve(here, "locales");
  }
}

function readTemplateFile(
  localesDir: string,
  locale: SupportedLocale,
  id: TemplateId,
  file: string,
): string {
  const path = resolve(localesDir, locale, "email", id, file);
  return readFileSync(path, "utf-8");
}

function loadTemplate(localesDir: string, locale: SupportedLocale, id: TemplateId): LoadedTemplate {
  const subject = readTemplateFile(localesDir, locale, id, "subject.txt").trim();
  const text = readTemplateFile(localesDir, locale, id, "body.txt");
  let html: string | undefined;
  try {
    html = readTemplateFile(localesDir, locale, id, "body.html");
  } catch {
    // html is optional per the EmailSender / TemplateRenderer contract.
    html = undefined;
  }
  return html === undefined ? { subject, text } : { subject, text, html };
}

function loadAll(): Bundles {
  const localesDir = resolveLocalesDir();
  const out = {} as Bundles;
  for (const locale of SUPPORTED_LOCALES) {
    const bundle = {} as LocaleBundle;
    for (const id of KNOWN_TEMPLATE_IDS) {
      bundle[id] = loadTemplate(localesDir, locale, id);
    }
    out[locale] = bundle;
  }
  return out;
}

/**
 * Single-pass `{var}` interpolation. No nesting, no escapes — the
 * templates are operator-controlled and never carry user-supplied
 * source text. Undefined values render as the literal `{var}` token so
 * an accidental omission shows up loudly in QA rather than rendering as
 * `undefined`. Values are coerced via String() so numbers (e.g.
 * expires_minutes) interpolate cleanly.
 */
function interpolate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key: string) => {
    const value = variables[key];
    return value === undefined ? match : String(value);
  });
}

/** Concrete renderer carrying the eagerly-loaded bundle map. */
export class WorkerTemplateRenderer implements TemplateRendererInterface {
  readonly knownTemplateIds: readonly TemplateId[] = KNOWN_TEMPLATE_IDS;
  readonly #bundles: Bundles;

  constructor(bundles: Bundles = loadAll()) {
    this.#bundles = bundles;
  }

  render(
    templateId: string,
    locale: "en" | "ru",
    variables: Record<string, unknown>,
  ): { subject: string; text: string; html?: string } {
    if (!(KNOWN_TEMPLATE_IDS as readonly string[]).includes(templateId)) {
      throw new UnknownTemplateError(templateId);
    }
    const loc: SupportedLocale = locale === "ru" ? "ru" : "en";
    const tpl = this.#bundles[loc][templateId as TemplateId];
    const rendered: { subject: string; text: string; html?: string } = {
      subject: interpolate(tpl.subject, variables),
      text: interpolate(tpl.text, variables),
    };
    if (tpl.html !== undefined) {
      rendered.html = interpolate(tpl.html, variables);
    }
    return rendered;
  }
}

/**
 * Factory entry point — mirrors createTemplateRenderer named in
 * 10-01-PLAN.md artifacts block. The class constructor is kept exported
 * for tests/DI scenarios that want to inject a pre-loaded bundle.
 */
export function createTemplateRenderer(): WorkerTemplateRenderer {
  return new WorkerTemplateRenderer();
}
