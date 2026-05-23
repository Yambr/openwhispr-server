---
slug: cjm-pgbouncer-traefik-secrets
created: 2026-05-23
status: planned
---

# Quick: uncomment PGBOUNCER/TRAEFIK admin passwords in e2e-cjm + axe bootstrap

## Problem

Wave 2 #3 log-dump diagnostics caught the real cause of e2e-cjm + conformance-axe failures: migrate container's check-default-secrets.ts gate refuses to start when PGBOUNCER_ADMIN_PASSWORD or TRAEFIK_ADMIN_PASSWORD is unset or matches the deny-list. The slim-template comments both keys out (5-key operator contract); the workflows' bootstrap step never uncommented them, so bootstrap.sh skipped them.

## Fix

Add `sed -i` uncomment step before `tools/bootstrap.sh --ci` in both workflows. Mirrors the ci.yml smoke job pattern that already handles this.

## Files

- `.github/workflows/e2e-cjm.yml`
- `.github/workflows/conformance-axe.yml`

## Acceptance

- YAML parses
- Next CI run: migrate-1 reaches GREEN past the secrets gate; api boots; e2e drives actual tests
