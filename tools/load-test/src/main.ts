// Phase 08 / Plan 02 — k6 entry placeholder.
//
// Wave 2 (plan 06) wires the real k6 default export, options, and
// scenario routing. This stub exists so `pnpm --filter @openwhispr/load-test build`
// succeeds in Wave 0. It is excluded from vitest coverage because its
// runtime context is the k6 VM, not Node.
//
// Keeping the body tiny and side-effect-free guarantees the empty bundle
// builds without warnings.
export const PLACEHOLDER = "load-test-main";
