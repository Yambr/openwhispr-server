# ADR-0010: i18n runtime — i18next + ICU, en + ru baseline, operator-overridable via LOCALES_DIR

**Status:** accepted

**Date:** 2026-05-13

**Phase:** 10 — i18n, Docs & OSS Housekeeping

## Context

The project's constitutional rule I18N-01 requires `en` and `ru` as first-class
runtime locales from day one across:

- The api wire-error envelope (`error.message` localized per `Accept-Language`).
- Worker-emitted email templates (subject + body.txt + body.html per locale).
- The web UI (Next.js 15 App Router, RSC + client-component split).

DOCS-09 (English-only source artifacts) sits alongside I18N-01: code, comments,
identifiers, log keys, commit messages, audit_log payloads stay English; only
locale resource files and i18n test fixtures may carry non-English text.

Constraints:

- A single i18n library across api, worker, and web — operator mental model
  stays uniform, and the locale bundle format is reusable.
- ICU MessageFormat support is mandatory for Russian plural rules (`one`,
  `few`, `many`, `other`) and gender-aware messaging.
- Operators must be able to re-translate without rebuilding the container
  image — the locale dir is a bind-mount surface.
- The i18n runtime must work in three execution contexts: Node (api + worker),
  Edge runtime (Next.js middleware for locale negotiation), and browser
  (Next.js client islands).

## Decision

The i18n runtime is **i18next + i18next-icu**, with locale bundles under
`packages/i18n/locales/` for shared keys and per-app `locales/` for app-scoped
keys. Baseline locales: `en` and `ru`. Loading paths:

- **api**: i18next + i18next-icu + i18next-http-middleware + i18next-fs-backend;
  Fastify plugin mounts `req.i18n.t`. Bundles loaded from `apps/api/src/i18n/locales/`
  at build time, copied to `dist/` by tsup, and **overridable at run time** via
  `LOCALES_DIR` env (the docker-compose api service bind-mounts the source-tree
  locale dir read-only).
- **worker**: same as api — i18next-fs-backend loads template renderer bundles
  from `apps/worker/src/i18n/locales/`, also overridable via `LOCALES_DIR`.
- **web (Next.js)**: i18next + react-i18next + i18next-icu. Edge middleware
  runs `accept-language-parser` for the locale-negotiation chain
  (`cookie → Accept-Language → en`) and emits the `x-locale` request header
  for RSC layouts to read via `headers()`. Client islands re-hydrate from the
  serialized resource snapshot — only plain data crosses the RSC→Client
  boundary.

Completeness is enforced mechanically:

- A ts-morph `i18n-completeness` scanner asserts every typed-error class and
  every per-instance error code has en + ru translations.
- A CI job runs the scanner on every PR.
- An audit-log Cyrillic guard fails the INSERT if any payload value contains
  Cyrillic codepoints — the audit forensic surface stays English-only.

## Consequences

- **Easier:** every layer (api / worker / web) speaks the same `i18next.t(key,
  vars)` shape; bundle format is portable; ICU plural rules work uniformly;
  contributors learn one i18n model.
- **Easier (operator):** LOCALES_DIR is the override knob — replace bundles
  in-place, restart the container, locale change is live. No rebuild.
- **Easier (RSC)**: only a serialized resource snapshot crosses the RSC→Client
  boundary; the i18next instance is reconstructed on the client. This keeps
  the bundle small and the boundary surface narrow.
- **Harder:** three init paths (api Fastify plugin, worker bootstrap, web
  client + server factory) — three places to keep in sync. Documented in
  `docs/i18n.md`; the i18next-icu plugin must be registered on both server
  and client factories or plural rules silently drift.
- **Risk:** new tooling (i18next-icu) on the web side has known regression
  in older versions around ICU pluralization — pinned to ≥ 2.4.3 to avoid.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **node-polyglot** | No ICU MessageFormat support — Russian plural rules (`one/few/many/other`) cannot be expressed cleanly. |
| **FormatJS / react-intl directly** | Heavier client bundle; the React-only mental model does not extend to api + worker; would require a second library on the server. |
| **next-intl** | Strong for Pages Router, fragile for App-Router RSC. Phase 10 plan 10-02 evaluated and rejected — the RSC→Client serialization story is messy. |
| **Custom YAML-driven runtime** | Adds an in-house ICU implementation; CLAUDE.md prohibits reinventing well-supported libraries. |
| **Translate audit_log payloads** | Forensics needs a stable, ASCII-only payload surface; the audit-log Cyrillic guard enforces this with a fail-loud check. |

## References

- `docs/i18n.md` — operator locale guide
- `apps/api/src/i18n/init.ts` (api i18next bootstrap)
- `apps/worker/src/i18n/template-renderer.ts` (worker renderer)
- `apps/web/src/middleware.ts` (Edge middleware locale-negotiation)
- `apps/web/src/lib/i18n.ts`, `apps/web/src/lib/i18n-client.tsx`
- Phase 10 Plan 10-01 (server-side i18n end-to-end)
- Phase 10 Plan 10-02 (web-side ru i18n + RSC)
- ADR-0003 (English-only source artifacts)
- https://www.i18next.com/
- https://github.com/i18next/i18next-icu
