// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-a Task 1 RED stub — typecheck-only placeholder.
//
// Real implementation lands in Task 2 GREEN; this stub exists solely
// to satisfy the pre-commit web-typecheck hook on the RED commit.
// The stub throws so the unit specs still fail at render time —
// preserving the RED gate's "test fails" invariant.
"use client";

export interface ResetPasswordFormProps {
  token: string | null;
}

export function ResetPasswordForm(_props: ResetPasswordFormProps): React.JSX.Element {
  throw new Error("ResetPasswordForm: not yet implemented (Phase 55-01-a Task 2 GREEN)");
}
