---
slug: codeql-test-route-tree-ignore
created: 2026-05-23
status: planned
---

# Quick: extend CodeQL `paths-ignore` to cover the `__test/` route tree

## Problem

CodeQL alert #20 (`js/request-forgery` at `apps/api/src/routes/__test/fetch.ts:100`) fires on a **test-only** Fastify route whose sole purpose is to drive `globalThis.fetch` with a caller-supplied URL so the process-wide SSRF dispatcher can be exercised by `tests/e2e/ssrf-block.test.ts`. The route is REFUSED at production-veto time (NODE_ENV check in `apps/api/src/index.ts` plus per-route registration veto) and is unreachable in any production bundle.

The existing `paths-ignore` covers `tests/**`, `**/__tests__/**`, fixtures, and `tools/test-probe/**`. It does NOT cover the singular `__test/` directory used for Fastify test-only routes (a project convention distinct from unit-test trees).

## Fix

Add `**/__test/**` to `.github/codeql/codeql-config.yml` `paths-ignore` with a long-form comment explaining the production-veto rationale.

## Files

- `.github/codeql/codeql-config.yml` — +11 lines

## Acceptance

- YAML parses
- Next CodeQL scan clears alert #20

Tasks #16 (4× polynomial-redos already mitigated in code) and #14/#15 (false positives on already-hardened code) are documented in TaskList for dismiss-on-next-scan; this quick is the only one with a code/config change to land.
