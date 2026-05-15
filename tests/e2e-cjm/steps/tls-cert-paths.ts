// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 17 / Plan 02 — pure predicate for the Gherkin "no bootstrap-minted
// dev-CA cert ships in the prod image" step (Scenario 2, last `Then`).
//
// WR-01 fix: the original step impl in `tls.steps.ts` filtered every
// `*.crt` / `*.pem` in the tar listing, excluding only `node_modules/`.
// That guarantees a false positive against EVERY realistic node-based
// production image because `node:slim` / `debian:slim` / `ubuntu:*`
// derivatives all ship hundreds of system-trust certs under
// `etc/ssl/certs/*.pem`, `usr/share/ca-certificates/**/*.crt`,
// `usr/local/share/ca-certificates/**/*.crt`.
//
// The narrowed predicate ONLY flags filenames that match the exact
// dev-CA / mkcert artefact names the upstream codemod targets:
//
//   - rootCA*.pem          (mkcert default root CA filename)
//   - root-ca.{crt,key,pem}
//   - local.{crt,key,pem}  (bootstrap.sh + `make tls-trust` leaf)
//   - *.localhost.{crt,pem,key}    (per-host openssl artefacts)
//   - *mkcert*             (any path naming the binary)
//   - compose/traefik/certs/  (the bootstrap output dir)
//
// System-trust paths are intentionally NOT in this set — they MUST be
// allowed (they are how the prod image validates outbound TLS).

/**
 * Returns the subset of input paths that look like dev-CA / mkcert
 * artefacts (NOT the base-image's system trust store).
 *
 * @param paths - lines from a `tar -tf` listing of a `docker export` tarball
 * @returns matching paths (caller decides whether non-empty is a failure)
 */
export function findDevCaArtefacts(paths: string[]): string[] {
  return paths.filter((line) => DEV_CA_PATTERN.test(line));
}

// Exported for testability. The pattern is intentionally narrow — every
// addition needs a corresponding test row in `__tests__/tls-cert-paths.test.ts`.
//
// Anchors:
//   - basename match via `(^|/)`  — never matches a substring inside a
//                                    longer filename
//   - extension boundary via `($|\b)` for `.crt|.key|.pem` triples
export const DEV_CA_PATTERN: RegExp = new RegExp(
  [
    // rootCA*.pem  (mkcert default)
    String.raw`(^|/)rootCA[^/]*\.pem$`,
    // root-ca.{crt,key,pem}  (bootstrap.sh two-tier chain)
    String.raw`(^|/)root-ca\.(crt|key|pem)$`,
    // local.{crt,key,pem}  (bootstrap leaf + mkcert leaf in `make tls-trust`)
    String.raw`(^|/)local\.(crt|key|pem)$`,
    // <host>.localhost.{crt,pem,key} (per-host openssl artefacts)
    String.raw`(^|/)[A-Za-z0-9._-]+\.localhost\.(crt|key|pem)$`,
    // any path containing the literal `mkcert` token
    "mkcert",
    // the bootstrap output directory
    "(^|/)compose/traefik/certs/",
  ].join("|"),
);
