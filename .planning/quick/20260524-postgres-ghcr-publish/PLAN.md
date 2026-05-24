# PLAN — Publish openwhispr/postgres:17.5-pgpartman to GHCR

Date: 2026-05-24
Branch: worktree-agent-ab3c2fc80f37384e1

## Target image coordinates

- Registry: `ghcr.io`
- Repository: `yambr/openwhispr-postgres-17-pgpartman`
- Pinned tag for v1 swap: `17.5-bootstrap-1`
  - Rationale: matches the existing CNPG matrix convention
    (`<pg_minor>-<release-tag>`) and the `bootstrap-1` suffix signals
    this is the FIRST publish (no prior `v*` release tag exists yet for
    this image). Future `v0.10.0` tag push will produce `17.5-0.10.0`.

## TDD step ordering

1. **RED — lint regression test FIRST** (`tools/lint-no-dockerhub-pg-image.test.ts`
   + `tools/lint-no-dockerhub-pg-image.ts`): scan repo for any
   `openwhispr/postgres:` reference outside an allowlist
   (`compose/postgres/Dockerfile` comment, planning archives, this lint
   script + test). Expect FAIL on current main (22 hits).
   - Wire `lint:no-dockerhub-pg-image` into `package.json` + add a step
     to `.github/workflows/ci.yml` `lint-rls` or new lint job.
   - Verify the test FAILS locally before the fix (TDD red).

2. **GREEN — release.yml matrix entry**: add `postgres-17-pgpartman`
   to `.github/workflows/release.yml` matrix (mirrors CNPG entry).

3. **GREEN — reference swap (22 files)**:
   - Constants and helper defaults updated first
     (`packages/data/src/__tests__/helpers.ts:73,179`,
     `apps/api/tests/support/shared-pg.ts:47`,
     `apps/api/src/routes/__tests__/setup.ts:62`,
     `apps/api/src/routes/v1/keys/__tests__/setup.ts:54`).
   - All direct testcontainer constructor strings updated.
   - `docker-compose.yml:50` + `compose/docker-compose.embedded-litellm.yml:61`.
   - `docs/operations.md` references updated.

4. **GREEN — re-run lint, expect PASS**.

5. Atomic commits per logical step (see Commit plan below).

## Bootstrap handoff (maintainer-only step)

Because GHCR pushes require credentials this agent does not hold:

```bash
gh workflow run release.yml -f tag=bootstrap-1
```

This produces:
- `ghcr.io/yambr/openwhispr-postgres-17-pgpartman:bootstrap-1`
- `ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1`

The 22 reference swaps in this PR are pinned to the convenience tag
`17.5-bootstrap-1`. If the maintainer picks a different bootstrap
tag they MUST `sed -i 's/17.5-bootstrap-1/<chosen-tag>/g'` the
swapped files before merge.

## Verification

1. `pnpm exec tsx tools/lint-no-dockerhub-pg-image.ts` → exit 0
2. `pnpm test --filter @openwhispr/data tests/unit/__tests__/rls-property.test.ts`
   (one of the failing 8) → green
3. `docker manifest inspect ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1`
   → succeeds (post-bootstrap)
4. `grep -rn "openwhispr/postgres:" --exclude-dir=node_modules .` →
   only allowlisted hits remain (comments / archives / the lint script
   itself).

## Commit plan (atomic)

- **C1**: `feat(ci): publish openwhispr-postgres-17-pgpartman to GHCR`
  - release.yml matrix entry
- **C2**: `test(tools): add lint-no-dockerhub-pg-image regression guard`
  - tools/lint-no-dockerhub-pg-image.ts + .test.ts + allowlist
  - package.json script
  - ci.yml step
- **C3**: `refactor(tests): pin postgres testcontainer image to GHCR`
  - All 22 reference swaps (atomic — they share the same intent)
- **C4**: `docs(operations): update postgres image pull path to GHCR`
  - docs/operations.md only

## Deferred items

- ci.yml `lint-rls` + `test-migration` jobs continue to `docker build
  -t openwhispr/postgres:ci ./compose/postgres` locally. Switching them
  to GHCR pull adds network dependency without benefit (they own the
  image lifecycle in-job). NOT in scope.
- Speaches / litellm image publishing (separate failing-pull seen in
  CI log: `pull access denied for openwhispr-litellm`) — separate task.
