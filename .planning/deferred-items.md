# Deferred Items

Items discovered during execution that are out of scope for the current plan.

## From Plan 12-04 (Phase 12)

### AccountClient.test.tsx — pre-existing failure on "renders the three section headings"

**Discovered:** 2026-05-14 during Plan 12-04 execution.

**Symptom:** `apps/web/src/components/screens/account/__tests__/AccountClient.test.tsx > AccountClient (Phase 07.1 / Plan 08) > renders the three section headings (Profile / Active sessions / Danger zone)` fails because `screen.getByText(/Active sessions/i)` matches BOTH the subtitle paragraph (`Manage your profile, active sessions, and account deletion.`) AND the `<h2>Active sessions</h2>` heading.

**Why deferred:** The failure exists on `main` HEAD before any Plan 12-04 changes (verified by `git stash && pnpm vitest run AccountClient.test.tsx`). It is unrelated to the auth-screen / OIDC / wizard surface Plan 12-04 modifies, and falls outside the executor scope boundary (only fix issues directly caused by the current task's changes).

**Likely fix:** Tighten the assertion to `screen.getByRole("heading", { name: /^Active sessions$/i })` so it matches only the `<h2>`, not the prose. One-line change; ~3 minutes of work; belongs in a phase touching `AccountClient.tsx` directly.
