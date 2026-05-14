# Deferred Items

Items discovered during execution that are out of scope for the current plan.

## From Plan 12-04 (Phase 12)

### AccountClient.test.tsx — pre-existing failure on "renders the three section headings"

**Discovered:** 2026-05-14 during Plan 12-04 execution.

**Symptom:** `apps/web/src/components/screens/account/__tests__/AccountClient.test.tsx > AccountClient (Phase 07.1 / Plan 08) > renders the three section headings (Profile / Active sessions / Danger zone)` fails because `screen.getByText(/Active sessions/i)` matches BOTH the subtitle paragraph (`Manage your profile, active sessions, and account deletion.`) AND the `<h2>Active sessions</h2>` heading.

**Why deferred:** The failure exists on `main` HEAD before any Plan 12-04 changes (verified by `git stash && pnpm vitest run AccountClient.test.tsx`). It is unrelated to the auth-screen / OIDC / wizard surface Plan 12-04 modifies, and falls outside the executor scope boundary (only fix issues directly caused by the current task's changes).

**Likely fix:** Tighten the assertion to `screen.getByRole("heading", { name: /^Active sessions$/i })` so it matches only the `<h2>`, not the prose. One-line change; ~3 minutes of work; belongs in a phase touching `AccountClient.tsx` directly.

## From Plan 14-02 (Phase 14)

### refuse-default-secrets.test.ts — "exits 0 and writes a complete, deny-list-clean .env"

**Discovered:** 2026-05-14 during Plan 14-02 execution.

**Symptom:** `tests/self-tests/refuse-default-secrets.test.ts > DATA-05 self-test: bootstrap.sh generates valid .env on placeholders > exits 0 and writes a complete, deny-list-clean .env` fails — the fixture's `.env.example` uses non-canonical placeholder values (`POSTGRES_OWNER_PASSWORD=PLACEHOLDER_OWNER`, etc.) but bootstrap.sh's three-way value semantics (Phase 02.2) regenerate only the literal `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE`. Every other value is preserved as a "real default config value", so the test's `expect(value).not.toBe(expected[key])` assertion fires.

**Why deferred:** The failure exists on `main` HEAD *before* any Plan 14-02 changes (verified by `git stash && pnpm vitest run refuse-default-secrets.test.ts` — same assertion fails identically). It is unrelated to Plan 14-02's bootstrap template-override surface and falls outside the executor scope boundary (only fix issues directly caused by the current task's changes).

**Likely fix:** Update the fixture body to use the canonical `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` literal for every secret key; the regeneration path then exercises correctly. Belongs in a phase auditing bootstrap fixtures or in Phase 14's own bootstrap-test sweep if it grows.
