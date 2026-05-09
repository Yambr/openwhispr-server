## Phase 02.12 deferred items

### Pre-existing typecheck noise (NOT introduced by 02.12)

- `packages/data/src/__tests__/0003_better_auth_tenant_defaults.test.ts:73,86` — `error TS2532: Object is possibly 'undefined'.` on `u.rows[0].id`. Verified pre-existing (`git stash` before 02.12 changes shows the same errors at lines 72/85, shifted by one comment line). Out of scope per gsd-executor scope-boundary rule. Candidate fix: assert non-null after rows query.
