// Phase 0 i18n loader stub. Reads the en/ru common.json files from disk so the
// rest of the codebase can depend on a real loader signature; full i18next
// wiring (CLDR plurals, Accept-Language negotiation) lands in Phase 7+.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function loadLocale(locale: 'en' | 'ru'): Record<string, string> {
  const path = resolve(here, '..', 'locales', locale, 'common.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}
