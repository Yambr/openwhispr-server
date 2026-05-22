// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * R35 (quick-task 20260522) — lenient INPUT datetime validator.
 *
 * The immutable OpenWhispr desktop client stores `created_at`/`updated_at`
 * in SQLite columns declared `DATETIME DEFAULT CURRENT_TIMESTAMP`, which
 * yields the SPACE-SEPARATED form `"2026-05-22 16:05:11"` (no `T`, no
 * offset). Zod `.datetime({ offset: true })` requires the RFC-3339 `T`-form,
 * so the client's value is rejected with 400 — cloud sync never starts.
 *
 * `INPUT_DATETIME` accepts BOTH the SQLite space form AND RFC-3339, and
 * `.transform()`s the value to canonical RFC-3339 so any downstream
 * consumer reads a clean string. It is INPUT-only — the `Cloud*` RESPONSE
 * schemas keep the strict `z.string().datetime({ offset: true })`
 * validator. The input/output asymmetry is intentional.
 */
import { z } from "zod";

// Date-shape regex: `YYYY-MM-DD`, a space OR `T` separator, `HH:MM:SS`,
// optional fractional seconds, optional `Z`/`±HH:MM` offset. The Y/M/D
// digits are captured so the calendar-validity check can compare them
// against the round-tripped Date components.
const SQLITE_OR_ISO =
  /^(\d{4})-(\d{2})-(\d{2})[ T]\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Roll-over-detecting calendar-validity check.
 *
 * `Date.parse` silently rolls impossible dates (Feb 30 -> Mar 2), so a
 * bare `!Number.isNaN(Date.parse(...))` would WRONGLY accept
 * `"2026-02-30 12:00:00"`. For `Z`/offset-less inputs the normalized form
 * ends in `Z`, so the UTC getters read back the exact calendar components
 * and we compare them to the source digits. For explicit-offset inputs
 * (machine-generated, never a calendar typo) a plain non-NaN parse is
 * sufficient — the UTC getters would read offset-shifted components and
 * could false-reject a valid local date.
 */
function isCalendarValid(source: string, normalized: string): boolean {
  const t = Date.parse(normalized);
  if (Number.isNaN(t)) return false;
  const m = SQLITE_OR_ISO.exec(source);
  if (!m) return false;
  const hasOffset = /[+-]\d{2}:?\d{2}$/.test(source);
  if (hasOffset) return true; // non-NaN parse already passed
  const d = new Date(t);
  const [, yy, mm, dd] = m;
  return (
    d.getUTCFullYear() === Number(yy) &&
    d.getUTCMonth() + 1 === Number(mm) &&
    d.getUTCDate() === Number(dd)
  );
}

/**
 * Lenient INPUT datetime: accepts the SQLite space form + RFC-3339,
 * normalizes to canonical RFC-3339. The `.refine` messages are stable
 * machine keys (`datetime.invalid_format`), NOT inline English — mirrors
 * the `metadata.too_large` precedent in conversations.ts (LOCKER / i18n
 * doctrine).
 */
export const INPUT_DATETIME = z
  .string()
  .trim()
  .refine((s) => SQLITE_OR_ISO.test(s), {
    message: "datetime.invalid_format",
  })
  .refine((s) => isCalendarValid(s, s.replace(" ", "T")), {
    message: "datetime.invalid_format",
  })
  .transform((s) => {
    const normalized = s.replace(" ", "T");
    return /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  });
