# CONTEXT — Advisor decision: keep two images, publish both to GHCR

Date: 2026-05-24
Decision authority: advisor analysis applied inline (per
`feedback_advisor_for_grey_areas`); see "Why not gsd-advisor-researcher"
below.

## Recommendation (one paragraph)

**Keep both Dockerfiles, publish both to GHCR.** Add a single new matrix
entry `name: postgres-17-pgpartman` (context `compose/postgres`,
`pg_minor: "17.5"`) to `.github/workflows/release.yml`. The compose +
22 testcontainer call sites swap from `openwhispr/postgres:17.5-pgpartman`
to `ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-<tag>`.

**Rationale**: pg_partman version drift is the dominant factor —
Debian Trixie's apt-package ships pg_partman 5.1.0, but migration 0014
was authored against 5.2.4 (procedure signatures and partition-templating
behavior differ across the 5.1→5.2 boundary). Unifying on the Debian
image would silently downgrade the extension everywhere `pnpm test`
runs, with re-validation cost across 22 testcontainer call sites that
exceeds the cost of one extra release matrix entry. Image size is a
secondary win (22 testcontainer pulls per CI run × 300 MB Debian
overhead) — but on its own would not justify the split. The two
Dockerfiles already exist, already work, already serve distinct
runtime targets (CNPG cluster with BGW preload vs single-container
postgres with BullMQ-driven maintenance). Publishing both honors the
existing architecture instead of inverting it.

## Why not gsd-advisor-researcher

The decision is bounded (two concrete choices, both fully implementable),
the determining facts are objectively verifiable in <10 minutes
(pg_partman versions, image sizes, existing matrix shape), and the
constitutional rule that biases the answer is explicit in `CLAUDE.md`
("no workarounds — enterprise-grade only"). Spawning an
advisor-researcher would add 5-10 min of latency without changing the
output. Logged here for audit transparency.

## Tag scheme decision

`ghcr.io/yambr/openwhispr-postgres-17-pgpartman` with tags:
- `:<release-tag>` (e.g. `:0.10.0`)
- `:17.5-<release-tag>` (e.g. `:17.5-0.10.0`) — convenience tag mirroring
  the existing CNPG entry's `pg_minor` convention.

For test code that hard-codes a fixed image string we use the
convenience tag pinned to a published release tag, NOT `:latest` —
testcontainers must be reproducible (constitutional discipline rule 5
re: maximum test automation requires deterministic CI).

## Bootstrap requirement

GHCR has nothing published yet. After this PR merges:

1. Maintainer runs `gh workflow run release.yml -f tag=postgres-pgpartman-bootstrap-1`
   (or any non-versioned tag) to publish the FIRST image build that
   the new matrix entry produces.
2. The 22 reference swaps are pinned to that bootstrap tag (or a
   subsequent published release tag).
3. Future `v*` tag pushes naturally rebuild + republish.

The orchestrator (this agent) cannot push to GHCR from local — credential
isolation is by design. This handoff is captured in PLAN.md §Verify.
