// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-a Task 1 RED stub — typecheck-only placeholder.
//
// Real implementation lands in Task 2 GREEN; this stub exists solely
// to satisfy the pre-commit web-typecheck hook on the RED commit
// (Strict TDD: the failing test must exist on its own commit, but
// the pre-commit hook refuses to land a commit with broken types).
// The stub throws so the unit specs still fail at render time —
// preserving the RED gate's "test fails" invariant.
"use client";

export function ForgotPasswordForm(): React.JSX.Element {
  throw new Error("ForgotPasswordForm: not yet implemented (Phase 55-01-a Task 2 GREEN)");
}
