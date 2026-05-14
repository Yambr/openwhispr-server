// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-03 / Task 3 — Zod 4 setErrorMap ↔ i18next bridge
// (UICONF-03 per-field localized errors).
//
// Wires every Zod issue Code emitted by `setupSchema` to a key under
// the `common.validation.*` i18next namespace, with EN+RU parity
// asserted by the Phase-10 `i18n-russian-coverage.test.ts` gate.
//
// Zod 4 deprecates `z.setErrorMap()` in favour of `z.config({
// customError })`; we use the new API. The map returns `undefined` for
// unhandled codes so Zod falls back to its built-in English defaults
// (acceptable for non-form callers — only the wizard reaches this
// translator). When the issue's `message` is itself an i18next key the
// map prefers it (used by setupSchema's password regex .regex(..,key)
// hints, e.g. "password.mixed_classes").
//
// Importing this module has the side-effect of installing the global
// error map; the wizard imports it once at module-load time. Multiple
// imports are idempotent (`z.config` replaces the registration).
import type { i18n as I18nInstance } from "i18next";
import { z } from "zod";

/**
 * Install the global Zod customError map. Pass the live i18next
 * instance so language changes via `i18n.changeLanguage()` flow into
 * the translated messages immediately (the closure resolves keys on
 * every call).
 */
export function installZodI18n(i18n: I18nInstance): void {
  z.config({
    customError: (issue) => {
      // Zod 4 short-circuits this hook when a check carries an inline
      // message (e.g. `.regex(re, "key")`), so we route all localized
      // copy through the issue code → key map below; for hand-rolled
      // refinements pass the i18n leaf as `params.kind` (see
      // `setupSchema`'s combined password character-class refine).
      const code = issue.code;
      switch (code) {
        case "invalid_format": {
          // `format` is e.g. "email", "url", "regex" — map "email" to
          // the dedicated key; otherwise fall through to defaults.
          const format = (issue as { format?: string }).format;
          if (format === "email") {
            return { message: i18n.t("common.validation.email.invalid") };
          }
          return undefined;
        }
        case "too_small": {
          // Both `string` and `array` flow here; only string is
          // exercised by setupSchema. The minimum surfaces as
          // `minimum`.
          const minimum = (issue as { minimum?: number }).minimum;
          if (minimum === 12) {
            return { message: i18n.t("common.validation.password.min_length") };
          }
          return { message: i18n.t("common.validation.string.too_short") };
        }
        case "too_big": {
          return { message: i18n.t("common.validation.string.too_long") };
        }
        case "invalid_type": {
          // Empty string for a required field surfaces as invalid_type
          // when the schema uses .min(1) — that's actually too_small,
          // but `undefined` -> invalid_type is the canonical "required"
          // signal; route to the generic `required` key.
          return { message: i18n.t("common.validation.required") };
        }
        case "custom": {
          // Caller-supplied `.refine(fn, { params: { kind } })` with a
          // dot-separated `kind` key (e.g. "password.mixed_classes").
          // Look up `common.validation.<kind>`; fall through to Zod's
          // default if either the kind or the i18n key is missing.
          const params = (issue as { params?: { kind?: unknown } }).params;
          const kind = params?.kind;
          if (typeof kind === "string") {
            const key = `common.validation.${kind}`;
            if (i18n.exists(key)) {
              return { message: i18n.t(key) };
            }
          }
          return undefined;
        }
        default:
          return undefined;
      }
    },
  });
}
