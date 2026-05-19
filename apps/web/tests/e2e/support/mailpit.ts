// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 54 / Plan 54-01 RED STUB — typed surface only, no behaviour.
//
// This stub exists so the unit tests at
// apps/web/tests/e2e/support/__tests__/mailpit.test.ts can import the
// public interface and FAIL at runtime (not at typecheck time). The
// GREEN implementation lands in the very next commit and replaces this
// file entirely.
export const MAILPIT_BASE: string = process.env.MAILPIT_API_URL ?? "http://localhost:8025/api/v1";

export interface MailpitFetchOptions {
  since: Date;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export function fetchVerificationLink(_email: string, _opts: MailpitFetchOptions): Promise<string> {
  return Promise.reject(new Error("RED stub: fetchVerificationLink not implemented yet"));
}

export function fetchPasswordResetLink(
  _email: string,
  _opts: MailpitFetchOptions,
): Promise<string> {
  return Promise.reject(new Error("RED stub: fetchPasswordResetLink not implemented yet"));
}

export function clearMessages(): Promise<void> {
  return Promise.reject(new Error("RED stub: clearMessages not implemented yet"));
}
