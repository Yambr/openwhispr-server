// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 38: package retired (Phase 0 placeholder; Better Auth lives in
// apps/api/src/auth.ts). Package renamed @openwhispr/auth → @openwhispr/auth-stub
// + private:true so the load-bearing @openwhispr/auth namespace cannot be
// published or squatted. The export is retained as a Stryker mutation target.
export function isPlaceholder(): boolean {
  return true;
}
