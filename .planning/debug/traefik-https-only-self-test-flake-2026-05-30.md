# Flake: traefik-https-only self-test (WIRE-20) 404 under full test:all sweep

**Date:** 2026-05-30
**Test:** `tests/self-tests/traefik-https-only.test.ts` > WIRE-20 — Traefik
HTTPS-only redirect > `http://api.localhost/api/health -> 301/302/308`
**Symptom:** `expected [301, 302, 308] to include 404` — traefik returned
404 instead of the entrypoint-level HTTPS redirect.

## Verdict: ENVIRONMENTAL FLAKE (not a regression)

- Failed once inside a full `pnpm test:all` sweep (tip 0aa6fdf3,
  feat/oidc-provider-name). The branch change (OIDC_PROVIDER_NAME) touches
  ONLY `apps/api/src/lib/oidc-providers.ts` + tests + docs — zero traefik /
  compose / ingress / health surface. Causally impossible for #12 to cause
  a traefik routing failure.
- **Re-ran in isolation on a clean docker env → PASSED (1/1, 5.7s).**
  Deterministic-green when the ingress overlay owns port 80 uncontended.

## Root cause (timing/port contention)

The self-test boots the `compose/docker-compose.ingress.yml` overlay and
hits `http://127.0.0.1:80/api/health` with `Host: api.localhost`. During a
full sweep, other self-test files cycle their own compose stacks (up/down)
and a Ryuk-less testcontainers postgres leaked (`dazzling_panini`,
`org.testcontainers=true`, started mid-run). The traefik file-provider
router / the api backend behind it was not ready (or port 80 was being
re-bound by a tearing-down neighbor) at assertion time → 404 from traefik
instead of the entrypoint 308.

The test already has a skip-guard (`describe.skipIf(!SHOULD_RUN)`,
`SHOULD_RUN = dockerAvailable && composeAtLeast(2,20) && !devStackUp()`,
added in 0f931d19) for the dev-stack-up case, but it does NOT guard against
intra-sweep port-80 contention from sibling self-tests.

## Follow-up (not blocking — logged for a future hardening pass)

Harden WIRE-20 against intra-sweep contention: either (a) poll
`/api/health` through traefik until the backend is routable (retry with a
short backoff before asserting the redirect status), or (b) serialize the
ingress-overlay self-tests onto a dedicated port lease so a neighbor's
teardown can't steal :80 mid-assertion. The `tests-self-tests` project
already runs `singleFork` sequential — the contention is cross-FILE
compose lifecycle, not intra-file parallelism, so a readiness-poll is the
lighter fix.

Sibling note: `litellm-up.test.ts` LITELLM-01 surfaced as an UNANNOTATED
suite-level skip in the same run — pre-existing, unrelated, worth a
separate annotate-or-fix pass so the evidence gate's unannotated-skip
counter stays clean.
