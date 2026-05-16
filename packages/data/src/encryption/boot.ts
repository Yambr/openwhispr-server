// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 02 — boot-time encryption configuration validator.
//
// Loud-fail gate that runs at app startup BEFORE any DB operation, so
// an operator with a missing/malformed MASTER_KEK or an unsupported
// `OPENWHISPR_KEY_PROVIDER` selection gets a synchronous, named exit
// code 78 (BSD EX_CONFIG) — not a runtime crash on the first request
// that touches an encrypted column.
//
// Why exit 78 specifically: BSD sysexits(3) defines EX_CONFIG as
// "configuration error" — operator-visible, distinct from generic
// runtime failures, scriptable in systemd / k8s liveness probes.
//
// Why we refuse `vault` / `kms` at boot: those providers ship as
// 27-line stubs in v1 that throw NOT_IMPLEMENTED on every method
// call. Without a boot-gate, a corp operator who sets
// `OPENWHISPR_KEY_PROVIDER=vault` ahead of the Phase-6 adapter
// shipping would have a silently-broken app that crashes on the
// first sign-in (or worse, encrypts under an empty DEK if any future
// regression made the stub fail-open). Loud-fail at startup is the
// cheap defence.
//
// This module wires the gate but does NOT call it itself — wiring
// into `apps/api/src/index.ts` + `apps/worker/src/index.ts` lands in
// Plan 33-04 to keep this commit narrowly scoped.

/** BSD sysexits(3) EX_CONFIG. Surfaced on every typed error below. */
export const EX_CONFIG = 78;

export class MasterKekMissingError extends Error {
  static readonly EXIT_CODE = EX_CONFIG;
  readonly EXIT_CODE = MasterKekMissingError.EXIT_CODE;
  constructor() {
    super(
      "MASTER_KEK env var not set. Generate a 32-byte AES-256 KEK and " +
        "set MASTER_KEK to its base64url encoding " +
        "(e.g. `openssl rand 32 | base64 | tr '+/' '-_' | tr -d '='`).",
    );
    this.name = "MasterKekMissingError";
  }
}

export class MasterKekInvalidLengthError extends Error {
  static readonly EXIT_CODE = EX_CONFIG;
  readonly EXIT_CODE = MasterKekInvalidLengthError.EXIT_CODE;
  constructor(actualBytes: number) {
    super(
      `MASTER_KEK must decode to 32 bytes (AES-256 key length); got ${actualBytes} bytes after base64url decoding.`,
    );
    this.name = "MasterKekInvalidLengthError";
  }
}

export class KeyProviderStubError extends Error {
  static readonly EXIT_CODE = EX_CONFIG;
  readonly EXIT_CODE = KeyProviderStubError.EXIT_CODE;
  constructor(providerId: string) {
    const detail =
      providerId === "vault"
        ? "VaultKeyProvider not implemented in v1; HashiCorp Vault adapter deferred to Phase 6+. Refusing boot to avoid silent misconfig."
        : providerId === "kms"
          ? "KmsKeyProvider not implemented in v1; AWS KMS adapter deferred to Phase 6+. Refusing boot to avoid silent misconfig."
          : `KeyProvider '${providerId}' is not a v1 production-supported provider.`;
    super(detail);
    this.name = "KeyProviderStubError";
  }
}

/**
 * Write a structured-ish error line to stderr and exit with the BSD
 * EX_CONFIG code. We avoid full JSON-structured logging here because
 * this runs BEFORE pino/the observability layer is bootstrapped —
 * stderr is the only sink guaranteed to be available.
 */
function failConfig(err: Error): never {
  process.stderr.write(`[encryption-boot] FATAL ${err.name}: ${err.message}\n`);
  process.exit(EX_CONFIG);
}

/**
 * Assert MASTER_KEK is present + decodes to a 32-byte key. Calls
 * `process.exit(78)` via {@link failConfig} on any violation.
 */
export function validateMasterKek(env: NodeJS.ProcessEnv = process.env): void {
  const raw = env.MASTER_KEK;
  if (!raw) {
    failConfig(new MasterKekMissingError());
  }
  // Buffer.from(*, "base64url") is total — it silently drops chars
  // outside the alphabet and returns whatever bytes it could decode.
  // We therefore only need to assert the resulting length.
  const decoded = Buffer.from(raw as string, "base64url");
  if (decoded.length !== 32) {
    failConfig(new MasterKekInvalidLengthError(decoded.length));
  }
}

/**
 * Assert the selected KeyProvider is one v1 actually implements.
 * `env` (default `env-key-provider.ts`) is supported; `vault` and
 * `kms` are stubs and refused at boot. Unknown values default
 * through to `env` (matches selectProvider() behavior).
 */
export function validateKeyProviderSelection(env: NodeJS.ProcessEnv = process.env): void {
  const id = env.OPENWHISPR_KEY_PROVIDER || "env";
  if (id === "vault" || id === "kms") {
    failConfig(new KeyProviderStubError(id));
  }
}

/**
 * Top-level entry — both validators in sequence. Wired into the api +
 * worker process boot sequences in Plan 33-04.
 */
export function validateEncryptionBoot(env: NodeJS.ProcessEnv = process.env): void {
  validateMasterKek(env);
  validateKeyProviderSelection(env);
}
