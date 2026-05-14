// SPDX-License-Identifier: Apache-2.0
// Phase 14 / Plan 04 / Task 1 — RED stub.
// Real implementation lands in the GREEN commit.
export type BYOKOverlay = "storage" | "observability" | "ingress" | "pgbouncer" | "dev-tools";

export type BYOKErrorCode =
  | "BYOK_STORAGE_REQUIRED"
  | "BYOK_OBSERVABILITY_REQUIRED"
  | "BYOK_INGRESS_REQUIRED"
  | "BYOK_DATABASE_REQUIRED"
  | "BYOK_SMTP_REQUIRED";

export interface BYOKFatalRecord {
  readonly event: "byok.required";
  readonly code: BYOKErrorCode;
  readonly overlay: BYOKOverlay;
  readonly missing: readonly string[];
  readonly hint: string;
}

export interface AssertBYOKConfigOpts {
  readonly logger?: unknown;
}

export function assertBYOKConfig(_env?: NodeJS.ProcessEnv, _opts?: AssertBYOKConfigOpts): void {
  throw new Error("assertBYOKConfig: not yet implemented (RED)");
}
