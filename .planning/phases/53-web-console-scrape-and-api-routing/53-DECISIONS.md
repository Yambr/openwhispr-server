---
phase: 53
plan: 04
type: decision-record
status: locked
decided: 2026-05-18
decider: user (after advisor research)
---

# Phase 53 / Plan 53-04 — web → api routing topology DECISION

## Question

How should the Next.js 15 web frontend on http://localhost:3000 call the
Fastify backend api on http://localhost:4000 for the Better Auth flow
(`/api/auth/*` namespace)?

## Decision — Option A: Next.js `rewrites()` proxy

`apps/web/next.config.ts` declares a `rewrites()` block that proxies
`/api/auth/:path*` (and other shared `/api/*` paths the web app needs) to
the backend api. The destination URL is built from `NEXT_PUBLIC_API_URL`
which Phase 07.1 / Plan 13.3 already plumbs at Docker build time via the
`ARG` mechanism. Inside docker-compose the value resolves to
`http://api:3000` (docker-internal hostname); on a non-docker dev box
operators set `NEXT_PUBLIC_API_URL=http://localhost:4000`.

The Better Auth client (`apps/web/src/lib/auth-client.ts`) keeps its
default same-origin `baseURL` — no client-side change. The browser sees
one origin (`http://localhost:3000`), cookies are first-party, no CORS,
no `SameSite=None` / `Secure` complications.

## Rejected alternatives

- **B. Compose default flips to Traefik ingress overlay** — production-
  equivalent topology (web.localhost vs api.localhost host-split) but
  regresses the slim-core OOBE: mkcert / self-signed-cert step on the
  very first browser hit. Remains opt-in via
  `compose/docker-compose.ingress.yml` for operators who want prod-
  equivalent dev. Logged in `.planning/deferred-items.md` as a future
  phase candidate once Phase 17's mkcert UX is hardened enough.

- **C. Absolute `NEXT_PUBLIC_API_URL` cross-origin from browser** —
  structurally incompatible with plain-HTTP slim-core: forces
  `SameSite=None; Secure` on session cookies which Chrome rejects over
  HTTP, AND breaks Better Auth's `__Secure-` cookie prefix which the
  browser spec requires HTTPS for. The only escape — a NODE_ENV-branch
  in the cookie config — violates project Discipline rule 11 ("No
  NODE_ENV branches in runtime paths"). Hard reject.

## Rationale tied to CLAUDE.md hard rules

1. **No workarounds / enterprise-grade** — Option A needs zero
   conditional branching; the rewrite is static `next.config.ts` value
   resolved from a build-arg env var, same pattern as the existing
   `NEXT_PUBLIC_*` build args.

2. **Slim-core OOBE preserved** — `git clone && docker compose up`
   continues to work out-of-the-box without mkcert / cert-trust step.

3. **"Test what you deploy" satisfied at the contract layer, not
   topology** — production fidelity is enforced by `tests/contract/`
   against BACKEND_SPEC.md and by the Helm chart's IngressRoute e2e
   coverage (Phase 17). Dev compose does not have to mirror prod K8s
   ingress topology byte-for-byte.

4. **Better Auth idiomatic** — same-origin proxy is the canonical
   monorepo dev pattern Better Auth's docs endorse; cross-origin /
   `crossSubDomainCookies` is documented as the production
   configuration for genuinely-different-domain deployments.

5. **Smallest blast radius** — ~10 LOC in one file, zero new deps,
   zero client-side changes. The web-side e2e (Plan 53-05/06) is the
   only addition.

## Sources

- [Next.js integration | Better Auth](https://better-auth.com/docs/integrations/next)
- [Cookies | Better Auth](https://better-auth.com/docs/concepts/cookies)
- [next.config.js: rewrites | Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites)
- Better Auth discussions #5578, #5253 (separate frontend + backend
  patterns — same-origin proxy endorsed for monorepo dev)

## Implementation contract for Plan 53-06 GREEN

- `apps/web/next.config.ts` adds:
  ```ts
  async rewrites() {
    const apiOrigin = process.env.NEXT_PUBLIC_API_URL || "http://api:3000";
    return [{ source: "/api/auth/:path*", destination: `${apiOrigin}/api/auth/:path*` }];
  }
  ```
- `apps/web/Dockerfile` already accepts `ARG NEXT_PUBLIC_API_URL` per
  Phase 07.1 / Plan 13.3.
- `docker-compose.yml` `web:` service `build.args` passes
  `NEXT_PUBLIC_API_URL: http://api:3000`.
- `apps/web/src/lib/auth-client.ts` — no change.

## Deferred follow-up

`.planning/deferred-items.md` should carry an entry for "Phase 5X —
Traefik ingress as slim-core default once mkcert UX is hardened" so
the dev-vs-prod topology asymmetry is not silently forgotten.
