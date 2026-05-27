// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260528-370 — env-driven build-info parser.
//
// `GET /api/health` surfaces three additive fields (`version`, `commit_sha`,
// `image_tag`) so operators can prove which image is serving a given replica
// from a single `curl` without `kubectl` access. The values originate in
// `apps/api/Dockerfile`'s runtime stage via three `ARG`s
// (`BUILD_VERSION` / `BUILD_SHA` / `IMAGE_TAG`) which flow into three
// `ENV`s (`OPENWHISPR_BUILD_VERSION` / `OPENWHISPR_BUILD_SHA` /
// `OPENWHISPR_IMAGE_TAG`). The `release.yml` workflow's
// `docker/build-push-action@v7` step populates the ARGs via `build-args`
// at image build time; local `docker build` (no `--build-arg`) defaults to
// the literal `"unknown"`.
//
// Module contract:
//   * Pure, sync, zero I/O.
//   * Never captures `process.env` at module scope — always reads the `env`
//     argument (defaults to `process.env` at call time). Test harnesses pass
//     explicit env snapshots; production resolves once at boot inside
//     `buildApp`. LOCKER-01 compliant (lives under `config/`).
//   * Each field is trimmed; empty / whitespace-only / missing values resolve
//     to `BUILD_INFO_UNKNOWN` (the literal `"unknown"`). Operators grep
//     production replicas for the literal to detect images built outside
//     `release.yml`.
//   * Each field is hard-truncated to 120 chars. Semver (~12 chars),
//     SHA-40 (40 chars), and OCI tag-name (max ~128 chars unenforced) all
//     fit comfortably; the cap defends against pathological env injection
//     (a 100KB `OPENWHISPR_IMAGE_TAG` crashing JSON.stringify or saturating
//     the kubelet log sink). LOCKER-05 defense-in-depth — `BuildInfo` is
//     not an Error subclass, but the truncation discipline carries over.

/**
 * Sentinel string surfaced in any of the three build-info fields when the
 * corresponding env var is unset / blank / whitespace-only. Operators grep
 * for the literal `"unknown"` across production replicas to detect images
 * built outside the canonical `release.yml` workflow. Exported as a named
 * const so call sites (route handler defaults, tests) never inline the
 * literal — LOCKER-03 compliant.
 */
export const BUILD_INFO_UNKNOWN = "unknown" as const;

/**
 * Hard upper bound on a single build-info field's length (LOCKER-05 defense
 * in depth — over-long env injection cannot saturate the JSON response).
 */
const MAX_FIELD_LEN = 120;

/**
 * Build-info DTO threaded through `ProbesDeps.buildInfo` into the
 * `GET /api/health` handler. All three fields are non-empty strings;
 * `BUILD_INFO_UNKNOWN` is the documented sentinel for an unset value.
 */
export interface BuildInfo {
  readonly version: string;
  readonly commitSha: string;
  readonly imageTag: string;
}

/**
 * Read a single env-var by name, treating empty / whitespace-only / missing
 * values as `BUILD_INFO_UNKNOWN`. Trims surrounding whitespace and hard-caps
 * the result at `MAX_FIELD_LEN`.
 */
function readEnvField(env: NodeJS.ProcessEnv, name: string): string {
  const raw = env[name];
  if (raw === undefined) return BUILD_INFO_UNKNOWN;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return BUILD_INFO_UNKNOWN;
  if (trimmed.length > MAX_FIELD_LEN) return trimmed.slice(0, MAX_FIELD_LEN);
  return trimmed;
}

/**
 * Parse `OPENWHISPR_BUILD_VERSION` / `OPENWHISPR_BUILD_SHA` /
 * `OPENWHISPR_IMAGE_TAG` from the supplied env snapshot into a `BuildInfo`.
 * Defaults to live `process.env` when called with no argument; tests pass
 * explicit snapshots to avoid mutating `process.env`.
 */
export function parseBuildInfoFromEnv(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return {
    version: readEnvField(env, "OPENWHISPR_BUILD_VERSION"),
    commitSha: readEnvField(env, "OPENWHISPR_BUILD_SHA"),
    imageTag: readEnvField(env, "OPENWHISPR_IMAGE_TAG"),
  };
}
