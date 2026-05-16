// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.g / HI-01 — package retired (Phase 0 placeholder; real i18n lives
// in apps/api/src/i18n/init.ts (server-side, mounted in bootstrap) and
// apps/web/src/locales/{en,ru}/{common,admin,end-user}.json (UI bundles,
// Phase 10 closure)). Package renamed @openwhispr/i18n → @openwhispr/i18n-stub
// + private:true so the load-bearing @openwhispr/i18n namespace cannot be
// published or squatted. The export is retained as a Stryker mutation target,
// mirroring the Phase 38 @openwhispr/auth → @openwhispr/auth-stub precedent.
//
// DO NOT IMPORT. If you need i18n in new code, use the apps/api/web surfaces
// listed above.
export function isPlaceholder(): boolean {
  return true;
}
