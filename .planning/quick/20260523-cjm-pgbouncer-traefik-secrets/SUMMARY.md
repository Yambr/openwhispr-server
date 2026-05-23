---
slug: cjm-pgbouncer-traefik-secrets
created: 2026-05-23
completed: 2026-05-23
status: complete
---

# Summary — uncomment PGBOUNCER + TRAEFIK admin passwords in e2e-cjm/axe bootstrap

## What

After Wave 2 #3 (`88821ff7` ci-compose-log-dump) shipped the diagnostics,
the first failing run on `93464b70` uploaded `compose-logs/` artifact.
`migrate.log` revealed the real exit-1 cause:

```
refusing to start: PGBOUNCER_ADMIN_PASSWORD is unset or matches deny-list
refusing to start: TRAEFIK_ADMIN_PASSWORD is unset or matches deny-list
```

`.env.slim.example` ships these two keys **commented out** (operator
contract: 5 active keys only). The `check-default-secrets.ts`
entrypoint gate in migrate/api containers REQUIRES both. The
e2e-cjm + conformance-axe workflows previously only added
`MINIO_ROOT_PASSWORD` + `GRAFANA_ADMIN_PASSWORD` overlay secrets —
they did NOT uncomment the pgbouncer/traefik slots, so bootstrap.sh
never filled them.

The slim-core `smoke` job in `ci.yml` already handles this correctly
(`sed -i 's/^# *PGBOUNCER_ADMIN_PASSWORD=/PGBOUNCER_ADMIN_PASSWORD=/'`).
Mirrored the same pattern to e2e-cjm.yml + conformance-axe.yml.

## Fix

Inserted a `sed -i` step BEFORE `tools/bootstrap.sh --ci` in both
workflows, uncommenting:
- `PGBOUNCER_ADMIN_PASSWORD=`
- `TRAEFIK_ADMIN_PASSWORD=`

so `bootstrap.sh` finds them and generates CI-safe values.

## Files

- `.github/workflows/e2e-cjm.yml` — +7 lines (sed + extra comment)
- `.github/workflows/conformance-axe.yml` — +7 lines (same)

## Verification

YAML validated. Next CI run on main should clear the migrate
"refusing to start" gate, letting api/web come up and the playwright
e2e drive actual user journeys.

## Commit

`df9e13d5` — `ci(cjm,axe): uncomment PGBOUNCER + TRAEFIK admin passwords pre-bootstrap`
