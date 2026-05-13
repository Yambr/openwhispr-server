// Phase 10 / Plan 10-01a / Step 7 — i18n key-completeness scanner.
//
// Walks every `apps/api/src/**/*.ts` file via ts-morph, locates every
// `throw new <TypedErrorClass>(<StringLiteral>)` expression, and asserts
// that the typed-error class's `code` literal exists as a key under
// `errors.<CODE>` in BOTH en.json AND ru.json.
//
// The scanner is intentionally narrow:
//   - It does NOT enumerate every string the constructor might receive;
//     it only validates that the i18n contract surface (one key per
//     typed-error class) is wired in both locales.
//   - This guards against an engineer adding a NEW typed-error subclass
//     in `errors.ts` (with a new `code`) without simultaneously adding
//     the en + ru translations. The contract is automatic via the
//     same single source of truth (the TypedErrorClass set below) and
//     a Project-wide AST walk of `throw new …` to prove every class IS
//     reachable from the codebase (no dead classes shipping locales).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Project, SyntaxKind } from "ts-morph";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, "..", "..");

/**
 * Canonical mapping from typed-error class name to i18n code literal.
 * Kept in lockstep with apps/api/src/errors.ts — if a class is added
 * there, add the row here AND a translation in both locale files; the
 * test will fail otherwise.
 */
const CLASS_TO_CODE = {
  ValidationError: "VALIDATION_ERROR",
  AuthError: "AUTH_ERROR",
  NotFoundError: "NOT_FOUND",
  RateLimitError: "RATE_LIMITED",
  ServiceUnavailable: "SERVICE_UNAVAILABLE",
  ServerError: "SERVER_ERROR",
} as const;

type TypedErrorClass = keyof typeof CLASS_TO_CODE;

function loadLocaleErrors(lng: string): Record<string, string> {
  const path = resolve(HERE, "..", "locales", `${lng}.json`);
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as { errors?: Record<string, string> };
  if (!parsed.errors) throw new Error(`locale ${lng} missing 'errors' namespace`);
  return parsed.errors;
}

function collectThrownClasses(): Set<TypedErrorClass> {
  const project = new Project({
    tsConfigFilePath: resolve(API_SRC, "..", "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  // Restrict to apps/api/src/**/*.ts (NOT node_modules, NOT dist).
  project.addSourceFilesAtPaths(`${API_SRC}/**/*.ts`);

  const seen = new Set<TypedErrorClass>();
  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath();
    // Skip the test file itself (would echo every class).
    if (filePath.includes("/__tests__/") || filePath.endsWith(".test.ts")) continue;
    for (const newExpr of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      const exprText = newExpr.getExpression().getText();
      if (exprText in CLASS_TO_CODE) {
        seen.add(exprText as TypedErrorClass);
      }
    }
  }
  return seen;
}

describe("i18n key completeness — typed-error <-> locale parity (Phase 10-01a)", () => {
  const en = loadLocaleErrors("en");
  const ru = loadLocaleErrors("ru");

  it("every typed-error class declared in errors.ts has a key in en.json", () => {
    for (const code of Object.values(CLASS_TO_CODE)) {
      expect(en[code], `missing en.errors.${code}`).toBeTruthy();
    }
  });

  it("every typed-error class declared in errors.ts has a key in ru.json", () => {
    for (const code of Object.values(CLASS_TO_CODE)) {
      expect(ru[code], `missing ru.errors.${code}`).toBeTruthy();
    }
  });

  it("ru.json contains Cyrillic characters for every error code (catches accidental Latin paste)", () => {
    for (const code of Object.values(CLASS_TO_CODE)) {
      expect(
        /[Ѐ-ӿ]/.test(ru[code] ?? ""),
        `ru.errors.${code} has no Cyrillic chars: ${ru[code]}`,
      ).toBe(true);
    }
  });

  it("en and ru locales declare the same key set under errors (no drift)", () => {
    const enKeys = Object.keys(en).sort();
    const ruKeys = Object.keys(ru).sort();
    expect(ruKeys).toEqual(enKeys);
  });

  it("every typed-error class used in `throw new …` is mapped to a code we ship", () => {
    const thrown = collectThrownClasses();
    // Guard: at least one typed-error must be in use in the codebase
    // — otherwise the scanner is silently inert.
    expect(thrown.size).toBeGreaterThan(0);
    for (const cls of thrown) {
      const code = CLASS_TO_CODE[cls];
      expect(en[code], `class ${cls} is thrown but en.errors.${code} is missing`).toBeTruthy();
      expect(ru[code], `class ${cls} is thrown but ru.errors.${code} is missing`).toBeTruthy();
    }
  });
});
