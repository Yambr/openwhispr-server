// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 10 / Plan 10-01a — i18next + ICU bootstrap.
//
// Responsibilities:
//   1. Construct a process-wide i18next instance pre-loaded with the
//      `errors` namespace for `en` and `ru` from
//      apps/api/src/i18n/locales/{en,ru}.json via i18next-fs-backend.
//   2. Wire ICU MessageFormat for plural / select formatting (B9: future
//      Russian plural forms; no ICU patterns shipped in 10-01a but the
//      formatter must already be installed so 10-01b can use it).
//   3. Expose a Fastify plugin that mounts i18next-http-middleware so
//      every request gets `req.i18n.t(...)` keyed off Accept-Language.
//
// Locale-dir resolution:
//   The locales directory is co-located with this source file at
//   ./locales/{lng}.json so the path stays valid under BOTH:
//     - source tree (vitest runs against src/**)
//     - tsup-bundled dist (post-Plan 10-01d the build step will copy
//       src/i18n/locales -> dist/i18n/locales; until then the dev server
//       resolves via the source path because tsup inlines this module).
//   The LOCALES_DIR env var override (B10 docker-compose mount) is
//   honored when set so operators can customize translations without a
//   rebuild — this is the same posture Phase 10-01d will codify in the
//   compose file.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import i18next, { type i18n as I18nInstance } from "i18next";
import Backend from "i18next-fs-backend";
import * as i18nMiddleware from "i18next-http-middleware";
import ICU from "i18next-icu";

/**
 * Resolve the absolute path of the locales directory.
 *
 * Order of resolution:
 *   1. `process.env.LOCALES_DIR` — operator override (docker-compose
 *      mount, K8s ConfigMap, on-host edits without a rebuild).
 *   2. `./locales` relative to this module's directory. Works under both
 *      the source tree (vitest, tsx) and the dist bundle (tsup output
 *      sits at `dist/index.js`; the build copy step in 10-01d will land
 *      `dist/i18n/locales/`).
 */
export function resolveLocalesDir(): string {
  const fromEnv = process.env.LOCALES_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  // Source tree: `here` is .../apps/api/src/i18n → ./locales is
  //   .../apps/api/src/i18n/locales (✓).
  // Bundled tree (tsup inlines this module into dist/index.js):
  //   `here` is .../apps/api/dist → ./locales is missing.
  //   tsup.config.ts's onSuccess copies the JSON files to
  //   dist/i18n/locales, so we fall back to that path when present.
  const sourceTreePath = resolve(here, "locales");
  // Try `i18n/locales` first (post-tsup bundle layout); fall back to
  // the source-tree path so vitest + tsx dev both keep working.
  try {
    // Existence check is synchronous — cheap, runs once at module load.
    const distLayout = resolve(here, "i18n", "locales");
    // Use a lightweight stat-equivalent via require/readFileSync below;
    // if the en.json under the dist layout exists, prefer it.
    readFileSync(resolve(distLayout, "en.json"));
    return distLayout;
  } catch {
    return sourceTreePath;
  }
}

const SUPPORTED_LANGUAGES = ["en", "ru"] as const;
const NAMESPACES = ["errors"] as const;

/**
 * Initialize the singleton i18next instance synchronously.
 *
 * We use `i18next-fs-backend` for symmetry with the documented stack
 * (RESEARCH § i18n), but pre-load the resources synchronously at module
 * import so the runtime translation calls have zero IO latency and the
 * Fastify error-handler can call `t(...)` from inside `setErrorHandler`
 * without awaiting. Synchronous load also keeps the contract test for
 * i18n-completeness deterministic.
 */
function initInstance(): I18nInstance {
  const localesDir = resolveLocalesDir();
  const resources: Record<string, Record<string, unknown>> = {};
  for (const lng of SUPPORTED_LANGUAGES) {
    const filePath = resolve(localesDir, `${lng}.json`);
    const raw = readFileSync(filePath, "utf-8");
    resources[lng] = JSON.parse(raw) as Record<string, unknown>;
  }

  i18next
    .use(Backend)
    .use(ICU)
    .use(i18nMiddleware.LanguageDetector)
    .init({
      fallbackLng: "en",
      // The call sites use `t('errors.<CODE>')` (Plan 10-01a §5 — same
      // shape mandated for error-handler.ts). Treat `.` as the
      // namespace separator and disable key nesting so the lookup is a
      // single dotless string keyed inside the `errors` namespace.
      nsSeparator: ".",
      keySeparator: false,
      supportedLngs: [...SUPPORTED_LANGUAGES],
      preload: [...SUPPORTED_LANGUAGES],
      ns: [...NAMESPACES],
      defaultNS: "errors",
      // Resources are pre-loaded synchronously above so initImmediate
      // can resolve cleanly without the fs backend round-tripping at
      // runtime; the backend is still registered for parity with the
      // production posture (custom locale dirs via LOCALES_DIR).
      // Each locale JSON file is `{ "errors": { CODE: text } }`. The
      // outer `errors` key IS the namespace, so we feed the file
      // directly to i18next as the per-language resource map
      // (i18next reads `resources[lng][ns]` so the structure matches
      // 1:1 — no manual unwrap required).
      resources: {
        en: resources.en as Record<string, Record<string, string>>,
        ru: resources.ru as Record<string, Record<string, string>>,
      },
      backend: {
        loadPath: resolve(localesDir, "{{lng}}.json"),
      },
      interpolation: { escapeValue: false },
    });

  return i18next;
}

/** Process-wide i18next instance. Initialized at module load. */
export const i18n: I18nInstance = initInstance();

/**
 * Fastify plugin: mounts i18next-http-middleware so every request
 * receives `req.i18n` (Accept-Language-driven) and `req.language`.
 */
const i18nPluginInner: FastifyPluginAsync = async (app: FastifyInstance) => {
  // i18next-http-middleware exposes a Connect-style handler
  // `(req,res,next) => void`. Fastify 5 does NOT ship `app.use` by
  // default — adding `@fastify/middie` for a single middleware would
  // pull in unnecessary surface area. Instead we adapt the Connect
  // signature to Fastify's `preHandler` hook by passing `req.raw` /
  // `reply.raw` and resolving the promise when the middleware's `next`
  // callback fires. The middleware mutates `req.raw.i18n` /
  // `req.raw.language`; we then mirror those onto the Fastify request
  // so route handlers can read `req.i18n` without dereferencing `.raw`.
  const handler = i18nMiddleware.handle(i18n);
  app.addHook("preHandler", (req, reply, done) => {
    handler(req.raw, reply.raw, () => {
      const raw = req.raw as unknown as { i18n?: unknown; language?: string };
      const r = req as unknown as { i18n?: unknown; language?: string };
      if (raw.i18n !== undefined) r.i18n = raw.i18n;
      if (raw.language !== undefined) r.language = raw.language;
      done();
    });
  });
};

export const i18nPlugin = fp(i18nPluginInner, {
  name: "i18n",
  fastify: "5.x",
});

export default i18nPlugin;
