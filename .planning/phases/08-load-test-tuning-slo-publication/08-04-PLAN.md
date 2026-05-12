---
phase: 08-load-test-tuning-slo-publication
plan: 04
type: tdd
wave: 0
depends_on:
  - 02
files_modified:
  - apps/api/scripts/fd-probe.sh
  - apps/api/scripts/fd-probe.test.sh
  - apps/api/Dockerfile
  - apps/api/Dockerfile.test.sh
  - compose/traefik/fd-probe.sh
  - compose/traefik/fd-probe.test.sh
autonomous: true
requirements:
  - SCALE-07
must_haves:
  truths:
    - "apps/api/scripts/fd-probe.sh exits 1 with a descriptive stderr message when `ulimit -n` returns < 65535 (default-secure)."
    - "apps/api/scripts/fd-probe.sh exits 0 and exec-chains to the next ENTRYPOINT arg when ulimit -n >= 65535."
    - "apps/api/Dockerfile ENTRYPOINT chain runs the probe BEFORE the existing check-default-secrets.cjs gate (which runs BEFORE node)."
    - "compose/traefik/fd-probe.sh exists for the Traefik container with the same contract."
    - "Both probes pass the `tools/load-test/scripts/fd-probe.test.sh` harness (created in plan 02) when FD_PROBE_PATH is pointed at them."
  artifacts:
    - path: "apps/api/scripts/fd-probe.sh"
      provides: "FD soft-limit gate ≥ 65535 with exec chain"
      min_lines: 15
      contains: "65535"
    - path: "apps/api/scripts/fd-probe.test.sh"
      provides: "Unit test simulating ulimit values via `sh -c 'ulimit -n N; ./fd-probe.sh true'`"
    - path: "compose/traefik/fd-probe.sh"
      provides: "Same contract for Traefik container"
      contains: "65535"
    - path: "apps/api/Dockerfile"
      provides: "ENTRYPOINT chain prepends fd-probe.sh before check-default-secrets.cjs"
      contains: "fd-probe.sh"
  key_links:
    - from: "apps/api/Dockerfile"
      to: "apps/api/scripts/fd-probe.sh"
      via: "COPY into image + ENTRYPOINT prepend"
      pattern: "fd-probe\\.sh"
    - from: "tools/load-test/scripts/fd-probe.test.sh"
      to: "apps/api/scripts/fd-probe.sh"
      via: "FD_PROBE_PATH env var"
      pattern: "FD_PROBE_PATH"
---

<objective>
Create the file-descriptor probe shell scripts for the api and traefik containers (D-TUNE-2). The probe reads `ulimit -n`, refuses to start if soft limit < 65535, and exec-chains into the next ENTRYPOINT arg if OK. This catches the case where a future PR loses the `ulimits:` block in docker-compose.yml (Wave 1 / plan 05 adds that block).

Two coordinated mechanisms per RESEARCH.md §Pattern 4:
1. `ulimits: nofile: { soft: 65535, hard: 65535 }` in docker-compose.yml (plan 05 — Wave 1).
2. ENTRYPOINT probe in api + traefik (THIS PLAN — Wave 0). Without #2, the api would silently accept a regressed limit; #2 makes regression loud.

Per D-TDD-1: tests RED before GREEN. Test harness already exists at `tools/load-test/scripts/fd-probe.test.sh` (plan 02). This plan implements the probe + adds a dedicated co-located unit test for each.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-load-test-tuning-slo-publication/08-CONTEXT.md
@.planning/phases/08-load-test-tuning-slo-publication/08-RESEARCH.md
@apps/api/Dockerfile
@tools/load-test/scripts/fd-probe.test.sh

<interfaces>
<!-- Probe contract (from RESEARCH.md §Pattern 4, lines 302-311). -->

```sh
#!/bin/sh
# fd-probe.sh — refuse to start if soft fd limit < 65535 (D-TUNE-2)
ulimit_n=$(ulimit -n)
if [ "$ulimit_n" -lt 65535 ]; then
  echo "[fd-probe] soft fd limit $ulimit_n < 65535 — refusing to start (D-TUNE-2)" >&2
  exit 1
fi
exec "$@"
```

<!-- ENTRYPOINT chain order in apps/api/Dockerfile (read current Dockerfile first to confirm): -->
<!-- BEFORE: ENTRYPOINT ["node", "/app/check-default-secrets.cjs", "node", "/app/dist/server.js"] -->
<!-- AFTER:  ENTRYPOINT ["/app/scripts/fd-probe.sh", "node", "/app/check-default-secrets.cjs", "node", "/app/dist/server.js"] -->

<!-- For Traefik: -->
<!-- Compose-level command override invokes the probe then exec-chains the upstream Traefik entrypoint. -->
<!-- Recommended (per RESEARCH.md line 314 option b): docker-compose `command:` override OR a thin Dockerfile that COPY-s the probe. -->
<!-- This plan SHIPS THE SCRIPT under compose/traefik/; plan 05 wires it via `entrypoint:` override in docker-compose.yml. -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: apps/api fd-probe.sh + Dockerfile wiring (RED → GREEN)</name>
  <files>apps/api/scripts/fd-probe.sh, apps/api/scripts/fd-probe.test.sh, apps/api/Dockerfile</files>
  <behavior>
    - Test 1 (RED): `(ulimit -n 1024; ./fd-probe.sh true)` exits 1 with stderr containing "1024" and "65535".
    - Test 2 (RED): `(ulimit -n 65535; ./fd-probe.sh true)` exits 0 (true succeeds via exec).
    - Test 3 (RED): `(ulimit -n 65535; ./fd-probe.sh false)` exits 1 (the exec'd command's exit code propagates).
    - Test 4 (RED): `(ulimit -n 70000; ./fd-probe.sh true)` exits 0 (≥ 65535 is acceptable).
    - Test 5 (RED): Script is executable (`test -x ./fd-probe.sh`).
    - Test 6 (RED): `grep -F '"/app/scripts/fd-probe.sh"' apps/api/Dockerfile` finds the ENTRYPOINT integration (RED initially because Dockerfile not yet modified).
    - Test 7 (RED): The probe appears in ENTRYPOINT BEFORE check-default-secrets.cjs (positional assertion via shell parsing of the line).
  </behavior>
  <action>
    Step 1 (RED): Write `apps/api/scripts/fd-probe.test.sh` (bash test harness with the 7 assertions). Use subshell `ulimit -n N` to simulate limit; note macOS bash may cap `ulimit -n` at the parent's limit, so document this and run inside a Docker container OR skip tests 1/4 on hosts where the simulation is not possible (test 2/3 always work because the simulation is at-or-below). Run the harness — MUST fail. Commit: `test(08-04): RED — apps/api fd-probe shell + Dockerfile wiring`.

    Step 2 (GREEN):
    - Create `apps/api/scripts/fd-probe.sh` per the interfaces block above. `chmod +x`.
    - Read current `apps/api/Dockerfile`. Locate the ENTRYPOINT line. Prepend `/app/scripts/fd-probe.sh` to the existing exec array. Add a `COPY apps/api/scripts/fd-probe.sh /app/scripts/fd-probe.sh` (with `--chmod=0755`) in the runner stage BEFORE the ENTRYPOINT line. If the Dockerfile uses a `runner` stage with `WORKDIR /app`, ensure the script is owned by the `node` user (or whatever user the image runs as).
    - Run `bash apps/api/scripts/fd-probe.test.sh` — MUST pass.
    - Also run via the plan-02 harness: `FD_PROBE_PATH=apps/api/scripts/fd-probe.sh bash tools/load-test/scripts/fd-probe.test.sh` — MUST pass.
    - Docker smoke: `docker build -t openwhispr-api-fdtest -f apps/api/Dockerfile .` then `docker run --rm --ulimit nofile=1024:1024 openwhispr-api-fdtest 2>&1 | grep -F "refusing to start"` MUST find the rejection message AND `docker run --rm --ulimit nofile=65535:65535 openwhispr-api-fdtest --version` (or whatever no-op flag api supports) MUST start past the probe. (If api has no --version flag, override with `--entrypoint /app/scripts/fd-probe.sh openwhispr-api-fdtest /bin/true` to test the probe in isolation.)
    - Commit: `feat(08-04): GREEN — apps/api fd-probe with ENTRYPOINT integration (D-TUNE-2)`.
  </action>
  <verify>
    <automated>bash apps/api/scripts/fd-probe.test.sh && FD_PROBE_PATH=apps/api/scripts/fd-probe.sh bash tools/load-test/scripts/fd-probe.test.sh</automated>
  </verify>
  <done>All 7 tests pass; Dockerfile ENTRYPOINT chain has probe before check-default-secrets.cjs; Docker smoke confirms probe fires under `--ulimit nofile=1024:1024`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: compose/traefik fd-probe.sh (RED → GREEN)</name>
  <files>compose/traefik/fd-probe.sh, compose/traefik/fd-probe.test.sh</files>
  <behavior>
    - Test 1 (RED): `(ulimit -n 1024; ./compose/traefik/fd-probe.sh /entrypoint.sh traefik)` exits 1 with stderr containing "65535".
    - Test 2 (RED): `(ulimit -n 65535; ./compose/traefik/fd-probe.sh true)` exits 0.
    - Test 3 (RED): Script is executable.
    - Test 4 (RED): Script content is byte-identical to apps/api/scripts/fd-probe.sh (single source of truth — assert via `diff -q`).
  </behavior>
  <action>
    Step 1 (RED): Write `compose/traefik/fd-probe.test.sh` with the 4 assertions. Test 4 is the contract that there is ONE probe definition; the traefik copy must equal the api copy. Run — MUST fail. Commit: `test(08-04): RED — compose/traefik fd-probe (must equal api copy)`.

    Step 2 (GREEN): Copy `apps/api/scripts/fd-probe.sh` to `compose/traefik/fd-probe.sh` (literal duplicate; chmod +x). Document inside the script via a header comment: `# Duplicate of apps/api/scripts/fd-probe.sh — kept byte-identical. Update both together.`. Verify `diff -q apps/api/scripts/fd-probe.sh compose/traefik/fd-probe.sh` returns nothing (files match). Run tests — MUST pass. Commit: `feat(08-04): GREEN — compose/traefik fd-probe (byte-identical to api copy)`.

    RATIONALE for duplication: A symlink across `apps/api/` and `compose/traefik/` would not survive Docker build contexts (which are scoped per service). The duplicate + `diff -q` test enforces drift detection; if a future change updates one, the test fails until the other is updated to match. This is preferable to a build-time generator (extra moving part).

    Plan 05 (Wave 1) wires this script into docker-compose.yml via either:
    - `entrypoint: ["/probe/fd-probe.sh", "/entrypoint.sh", "traefik"]` with a `volumes: ["./compose/traefik/fd-probe.sh:/probe/fd-probe.sh:ro"]` mount, OR
    - A net-new thin `compose/traefik/Dockerfile` wrapping the upstream image and `COPY`-ing the probe in.
    The choice is locked at plan 05 time. Document both options in a comment at the bottom of `compose/traefik/fd-probe.sh`.
  </action>
  <verify>
    <automated>bash compose/traefik/fd-probe.test.sh && diff -q apps/api/scripts/fd-probe.sh compose/traefik/fd-probe.sh</automated>
  </verify>
  <done>All 4 tests pass; the two scripts are byte-identical; drift-detection test stays green.</done>
</task>

</tasks>

<verification>
- `bash apps/api/scripts/fd-probe.test.sh` exits 0
- `bash compose/traefik/fd-probe.test.sh` exits 0
- `bash tools/load-test/scripts/fd-probe.test.sh` (plan-02 harness) green for both probe paths
- `diff -q apps/api/scripts/fd-probe.sh compose/traefik/fd-probe.sh` returns nothing
- Dockerfile probe wiring verified via container smoke (1024 → fail, 65535 → start)
</verification>

<success_criteria>
- Two probe scripts exist, are byte-identical, executable, and shell-test-covered
- api Dockerfile ENTRYPOINT chain integrates the probe before check-default-secrets.cjs
- Two RED→GREEN commit pairs land
- Wave 1 plan 05 can now wire the probe into Traefik via compose
</success_criteria>

<output>
After completion, create `.planning/phases/08-load-test-tuning-slo-publication/08-04-SUMMARY.md` per template.
</output>
