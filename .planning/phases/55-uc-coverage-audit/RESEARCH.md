# Phase 55 — UC coverage audit

**Researched:** 2026-05-19
**Confidence:** HIGH (every claim cites file:line; classifications follow the
user-mandated rule "no `expectNoBrowserErrors` ⇒ PARTIAL")
**Scope:** every public + authed-facing page in `apps/web/src/app/`, every
interactive element in the matching `apps/web/src/components/screens/**`
component, every Playwright spec under `apps/web/tests/e2e/`, and the
CJM Gherkin suite at `tests/e2e-cjm/features/`.

---

## Executive summary

| Bucket | Count | Share |
|--------|------:|------:|
| **Total UCs enumerated** | **108** | 100% |
| COVERED (happy path + `expectNoBrowserErrors`) | 9 | 8% |
| PARTIAL (spec exists, but missing one of: full click-through, `expectNoBrowserErrors`, or all states) | 67 | 62% |
| MISSING (no e2e spec at all) | 30 | 28% |
| BLOCKED (UI surface doesn't exist) | 2 | 2% |

> Note on the math: only four specs in the entire web suite call
> `expectNoBrowserErrors` — `100-acceptance/full-flow.spec.ts`,
> `p53-signup-smoke.spec.ts`, `100-fullflow-signup-verify-signin.spec.ts`,
> and the Russian-rendering check in `i18n-russian.spec.ts`. By the user's
> own classification rule that pulls every other `u*.spec.ts` test into
> PARTIAL, even when the happy path renders correctly. The 100-acceptance
> full-flow spec is the only one that gives "end-to-end console-clean"
> evidence for the screens it visits — and even it only **visits** ~6 of
> the 18 page routes.

### Top 10 gaps by user-visibility risk

1. **`/forgot-password` doesn't exist** (BLOCKED) — `apps/web/src/components/screens/auth/SignInForm.tsx:251-253` renders disabled muted text; tracked as `BUG-54-PRD-RESET-UI-MISSING` in `.planning/deferred-items.md:18`. Every user who forgets their password is stuck.
2. **Resend-verification CTA is uncovered** — `SignInForm.tsx:95-105, 126-151` handles `EMAIL_NOT_VERIFIED`; no spec ever triggers that state with the resend button. **MISSING.**
3. **Delete-account flow is uncovered** — `DeleteAccountDialog.tsx` (117 LOC, destructive irreversible action) has zero e2e coverage. `grep -nE "delete-account|deleteAccount"` against `apps/web/tests/e2e/` returns nothing. **MISSING.**
4. **Revoke individual session has no clicked assertion** — `u5-account.spec.ts:103-105` only asserts the buttons are visible; never clicks one. **PARTIAL.**
5. **Revoke-all-other-sessions has no clicked assertion** — `SessionsTable.tsx:155-163`; `u5-account.spec.ts:79` only asserts absence in single-session case. **PARTIAL.**
6. **OIDC button click → `signIn.social`** — `OidcButtons.tsx:50-61` calls `authClient.signIn.social`; web specs do not exercise this. CJM `oidc-providers.feature` exists but is a backend assertion, not a UI click-through. **PARTIAL (CJM) / MISSING (web UI).**
7. **Setup wizard never completes successfully** — `u-setup.spec.ts:15-21` runs ONLY axe-core and skips when setup is complete. The three-step IntersectionObserver wizard at `SetupForm.tsx:151-176` (Identity → Workspace → Review) has no e2e flow that fills it and POSTs. **PARTIAL (axe-only).**
8. **`tenant_rename_failed` warning branch** — `SetupForm.tsx:249-255` shows a non-blocking warning Alert; no spec triggers it. **MISSING.**
9. **Note detail tab switching** — `NoteDetailClient.tsx:264-302` renders three conditional tabs (Content/Transcript/Enhanced); `u9-note-detail.spec.ts:39` only confirms Content tab renders. Transcript and Enhanced tab visibility is never tested when their data is present. **PARTIAL.**
10. **Export buttons (JSON, MD) on note + transcription detail** — `NoteDetailClient.tsx:194-219`, `TranscriptionDetailClient.tsx:180-199`, `ConversationDetailClient.tsx:185-194`. Three buttons × three screens = 9 download UCs. Zero specs click them. **MISSING ×9.**

---

## Per-page UC inventory

### `/` (root redirect)

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| GET `/` → 307 redirect to `/app` | success | PARTIAL | `apps/web/src/app/page.tsx:13-15` is exercised indirectly by `99-cross-screen-smoke.spec.ts`; no spec asserts the 307 itself or that `/` does not flash a non-`/app` page (would be regression-relevant after middleware changes). |

### `/sign-in`

Source: `apps/web/src/app/(public)/sign-in/page.tsx` → `SignInForm.tsx` (270 LOC) wrapped in `AuthShell.tsx`.

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Render pristine form | empty | PARTIAL | `apps/web/tests/e2e/u1-sign-in.spec.ts:13` (no `expectNoBrowserErrors`) |
| Submit while in flight → button disabled | loading | PARTIAL | `u1-sign-in.spec.ts:21` |
| Invalid credentials → generic error Alert | error | PARTIAL | `u1-sign-in.spec.ts:39` |
| Valid credentials → push `/app` | success | COVERED | `apps/web/tests/e2e/100-acceptance/full-flow.spec.ts:88-91` (with `expectNoBrowserErrors`) |
| `EMAIL_NOT_VERIFIED` → unverified Alert renders | error | MISSING | `SignInForm.tsx:126-151`; no spec triggers this branch |
| Click resend-verification button → `sendVerificationEmail` | success | MISSING | `SignInForm.tsx:139-148`; never clicked |
| Resend-verification "sent" state copy | success | MISSING | `SignInForm.tsx:134-138`; never reached |
| Eye-toggle show/hide password | success | MISSING | `SignInForm.tsx:211-222`; never clicked |
| `Remember this device` checkbox toggle | success | MISSING | `SignInForm.tsx:228-246`; never asserted in `signIn.email` payload |
| Forgot-password muted text → real link to `/forgot-password` | success | **BLOCKED** | `SignInForm.tsx:251-253` is disabled muted static text; `BUG-54-PRD-RESET-UI-MISSING` |
| OIDC buttons render when providers configured | success | PARTIAL | `OidcButtons.tsx:41-83`; `99-cross-screen-smoke.spec.ts` doesn't assert presence; CJM `oidc-providers.feature` is backend-only |
| OIDC button click → social sign-in redirect | success | MISSING | `OidcButtons.tsx:50-61`; web never clicks the button |
| OIDC pending state disables siblings | loading | MISSING | `OidcButtons.tsx:75 disabled={pending !== null}`; never tested |
| Zero OIDC providers → row hidden (flicker gate) | empty | PARTIAL | `OidcButtons.tsx:46-48` flicker gate is unit-tested only |
| Link "Don't have an account? Sign up" → `/sign-up` | success | PARTIAL | `SignInForm.tsx:259-266`; no spec clicks the link |
| Axe WCAG 2.2 AA scan | success | PARTIAL | `u1-sign-in.spec.ts:71` (no console-error assertion) |
| Hydration parity in `ru` locale | success | COVERED | `i18n-russian.spec.ts:15-46` |
| AuthShell side-panel renders ≥lg | success | PARTIAL | `auth-shell-visual.spec.ts:28` (visual baseline only) |
| AuthShell footer Status/Docs/GitHub links (currently `href="#"`) | success | MISSING | `AuthShell.tsx:66-78`; three dead links shipped to production |

### `/sign-up`

Source: `apps/web/src/app/(public)/sign-up/page.tsx` → `SignUpForm.tsx` (261 LOC).

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Render pristine form | empty | PARTIAL | `u2-sign-up.spec.ts:8` |
| Submit while in flight → button disabled | loading | PARTIAL | `u2-sign-up.spec.ts:16` |
| Duplicate email → silent generic response | error | PARTIAL | `u2-sign-up.spec.ts:33` |
| Valid sign-up → success "Check your email" panel | success | COVERED | `100-acceptance/full-flow.spec.ts:81-85`, `p53-signup-smoke.spec.ts:29-70` |
| Generic error branch | error | MISSING | `SignUpForm.tsx:39, 150-162`; only duplicate is covered |
| Password strength meter — weak band | empty | MISSING | `SignUpForm.tsx:54-64`; `data-strength-band="weak"` never asserted |
| Password strength meter — fair band | success | MISSING | `data-strength-band="fair"` never asserted |
| Password strength meter — good band | success | MISSING | `data-strength-band="good"` never asserted |
| Password strength meter — strong band | success | MISSING | `data-strength-band="strong"` never asserted |
| Link "Already have an account? Sign in" → `/sign-in` | success | MISSING | `SignUpForm.tsx:250-257`; never clicked |
| OIDC row presence | success | PARTIAL | same as `/sign-in` |
| Axe WCAG 2.2 AA scan | success | PARTIAL | `u2-sign-up.spec.ts:70` |
| AuthShell visual baseline | success | PARTIAL | `auth-shell-visual.spec.ts:38` |

### `/verify-email`

Source: `apps/web/src/app/(public)/verify-email/page.tsx` → `VerifyEmailClient.tsx` (166 LOC).

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Visit without `?token=` → error variant with Mail icon | error | PARTIAL | `u3-verify-email.spec.ts:13` |
| Token request hanging → loading body visible | loading | PARTIAL | `u3-verify-email.spec.ts:18` |
| Invalid token → error variant with AlertCircle | error | PARTIAL | `u3-verify-email.spec.ts:27` |
| Valid token → success card with "Sign in" CTA | success | COVERED | `100-acceptance/full-flow.spec.ts:104-113`, `u3-verify-email.spec.ts:39` (full-flow has `expectNoBrowserErrors`) |
| Click "Sign in" CTA on success → `/sign-in` | success | PARTIAL | `VerifyEmailClient.tsx:135-137`; full-flow follows the link implicitly |
| Click "Sign up" CTA on error → `/sign-up` | success | MISSING | `VerifyEmailClient.tsx:158-161`; never clicked |
| AuthShell visual baseline (error branch) | success | PARTIAL | `auth-shell-visual.spec.ts:48` |
| Axe WCAG 2.2 AA scan | success | PARTIAL | `u3-verify-email.spec.ts:52` |

### `/setup`

Source: `apps/web/src/app/(public)/setup/page.tsx` → `SetupForm.tsx` (416 LOC, three-section IntersectionObserver wizard).

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Render wizard pristine, stepper at Identity | empty | PARTIAL | `u-setup.spec.ts:15` (axe-only, skips when setup is complete) |
| Scroll → step indicator advances (IntersectionObserver) | success | MISSING | `SetupForm.tsx:151-176`; never tested in playwright |
| Identity section — required fields validation | error | MISSING | name, email, password Zod errors via `installZodI18n` |
| Workspace section — required workspace input | error | MISSING | `SetupForm.tsx:331-348` |
| Workspace section — timezone select (defaults to browser TZ) | success | MISSING | `SetupForm.tsx:349-378` |
| Workspace section — timezone hydration parity (Phase 53 / Plan 53-30 fix) | success | MISSING | `SetupForm.tsx:125-145`; regression after Phase 53 — currently no test guards it |
| Review section — dl mirrors entered values | success | MISSING | `SetupForm.tsx:392-405` |
| Submit → 201 → push `/admin` | success | MISSING | `SetupForm.tsx:178-203`; never POSTed end-to-end |
| Submit → 200 (race loser) → push `/admin` | success | MISSING | `SetupForm.tsx:188` 201 || 200 branch |
| Submit → generic error Alert | error | MISSING | `SetupForm.tsx:243-248` |
| Submit → `tenant_rename_failed` warning Alert | success+warn | MISSING | `SetupForm.tsx:249-255`; non-blocking warning never asserted |
| AuthShell visual baseline | success | PARTIAL | `auth-shell-visual.spec.ts:58` |
| Axe WCAG 2.2 AA scan | success | PARTIAL | `u-setup.spec.ts:15` (skips when complete) |

### `/app` (Usage dashboard)

Source: `apps/web/src/app/(auth)/app/page.tsx` → `UsageDashboardClient.tsx` (170 LOC).

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Skeleton cards while usage endpoint stalls | loading | PARTIAL | `u4-usage.spec.ts:25` |
| Four KPI cards render with zero | empty | PARTIAL | `u4-usage.spec.ts:34` |
| Alert + Retry when `/api/usage` returns 500 | error | PARTIAL | `u4-usage.spec.ts:43` |
| KPI cards populate after seeded usage | success | PARTIAL | `u4-usage.spec.ts:49`; also COVERED at `100-acceptance/full-flow.spec.ts:118-121` |
| Click Refresh button → invalidates `queryKeys.usage()` | success | MISSING | `UsageDashboardClient.tsx:112-119`; click never asserted |
| `limitReached=true` → destructive Badge "Yes" | success | MISSING | `UsageDashboardClient.tsx:154-166` |
| Retry button click triggers refetch | error→success | MISSING | `UsageDashboardClient.tsx:90-92`; click handler never invoked in spec |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `u4-usage.spec.ts:57` |

### `/app/account`

Source: `apps/web/src/app/(auth)/app/account/page.tsx` → `AccountClient.tsx` (+ `SessionsTable.tsx`, `DeleteAccountDialog.tsx`).

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Profile card — name / email / verified badge / created date | success | PARTIAL | `u5-account.spec.ts:110-120` (axe-only); `100-acceptance/full-flow.spec.ts:137-139` |
| Sessions skeleton rows while list-sessions stalled | loading | PARTIAL | `u5-account.spec.ts:66` |
| Single session — bulk revoke button hidden | empty | PARTIAL | `u5-account.spec.ts:75` |
| List-sessions error → Alert + Retry | error | PARTIAL | `u5-account.spec.ts:83` |
| Two sessions render | success | PARTIAL | `u5-account.spec.ts:90` |
| **Click Revoke on a session row → `authClient.revokeSession`** | success | MISSING | `SessionsTable.tsx:198-205`; only existence asserted (`u5-account.spec.ts:103`) |
| Click "Revoke all other sessions" → `revokeOtherSessions` | success | MISSING | `SessionsTable.tsx:155-163`; only absence-in-single-session asserted |
| Retry button click triggers refetch | error→success | MISSING | `SessionsTable.tsx:136`; never clicked |
| Current-session badge "This device" rendered on row whose id matches | success | MISSING | `SessionsTable.tsx:184-192` |
| **Open Delete-account dialog** | success | MISSING | `DeleteAccountDialog.tsx:76-77`; trigger never clicked |
| **Typed-email mismatch → confirm button stays disabled** | error | MISSING | `DeleteAccountDialog.tsx:46, 103-105` |
| **Typed-email match → confirm enabled, click → `deleteAccount`** | success | MISSING | `DeleteAccountDialog.tsx:48-72`; destructive flow never tested |
| **Delete-account error → dialog stays open** | error | MISSING | `DeleteAccountDialog.tsx:56-59` |
| **Delete-account success → push `/sign-in`** | success | MISSING | `DeleteAccountDialog.tsx:68`; never tested |
| Cancel button closes dialog | success | MISSING | `DeleteAccountDialog.tsx:102` |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `u5-account.spec.ts:110` |

### `/app/transcriptions` (list)

Source: `apps/web/src/app/(auth)/app/transcriptions/page.tsx` → `TranscriptionsListClient.tsx`.

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Skeleton rows while list endpoint stalled | loading | PARTIAL | `u6-trx-list.spec.ts:22` |
| Empty card after clearAllData | empty | PARTIAL | `u6-trx-list.spec.ts:31` |
| Alert when list endpoint returns 500 | error | PARTIAL | `u6-trx-list.spec.ts:36` |
| N rows render + row click navigates to `/app/transcriptions/[id]` | success | PARTIAL | `u6-trx-list.spec.ts:42`; row-click navigation never asserted |
| Click Delete on a row → confirm → row removed | success | PARTIAL | `u6-trx-list.spec.ts:42` mentions Delete; `TranscriptionsListClient.tsx:229-251` AlertDialog cancel branch never tested |
| Cancel button on delete dialog | success | MISSING | `TranscriptionsListClient.tsx:243-245` |
| Load-more button when >= PAGE_LIMIT rows | success | MISSING | `TranscriptionsListClient.tsx:257-263`; never tested |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `u6-trx-list.spec.ts:51` |

### `/app/transcriptions/[id]` (detail)

Source: `TranscriptionDetailClient.tsx` (306 LOC).

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Skeleton while list pages | loading | PARTIAL | `u7-trx-detail.spec.ts:24` |
| Not-found state for missing id | empty | PARTIAL | `u7-trx-detail.spec.ts:33` |
| Click "Back" link on not-found → `/app/transcriptions` | success | MISSING | `TranscriptionDetailClient.tsx:162-164` |
| Alert when list endpoint returns 500 | error | PARTIAL | `u7-trx-detail.spec.ts:38` |
| Metadata + paragraphs render, no timecodes | success | PARTIAL | `u7-trx-detail.spec.ts:44` |
| **Click Copy → navigator.clipboard.writeText + sonner toast** | success | MISSING | `TranscriptionDetailClient.tsx:174-178` |
| **Click Export JSON → blob download** | success | MISSING | `TranscriptionDetailClient.tsx:180-183` |
| **Click Export MD → blob download** | success | MISSING | `TranscriptionDetailClient.tsx:185-199` |
| **Click Delete → confirm → push `/app/transcriptions`** | success | MISSING | `TranscriptionDetailClient.tsx:117-127, 218-241` |
| Cancel delete dialog | success | MISSING | `TranscriptionDetailClient.tsx:234` |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `u7-trx-detail.spec.ts:62` |

### `/app/notes` (list + FoldersSidebar)

Source: `NotesListClient.tsx`, `FoldersSidebar.tsx`.

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Skeleton rows while list stalled | loading | PARTIAL | `u8-notes-list.spec.ts:24` |
| Empty card after clearAllData | empty | PARTIAL | `u8-notes-list.spec.ts:33` |
| Alert when list endpoint returns 500 | error | PARTIAL | `u8-notes-list.spec.ts:38` |
| N rows render + D-UX5 zero folder mutation UI | success | PARTIAL | `u8-notes-list.spec.ts:44` |
| Click row title → navigate to `/app/notes/[id]` | success | MISSING | `NotesListClient.tsx:243` |
| Click Delete on a row → confirm → `/api/notes/delete` | success | MISSING | `NotesListClient.tsx:125-134, 250-275` |
| Cancel delete dialog | success | MISSING | `NotesListClient.tsx:267-269` |
| Type in search box + submit → push `/app/notes/search?q=…` | success | MISSING | `NotesListClient.tsx:144-149, 164-176` |
| Folder click in sidebar → push `?folder=<id>` filter | success | MISSING | `FoldersSidebar.tsx:43-49, 91-108` |
| "All notes" click → clear `?folder=` filter | success | MISSING | `FoldersSidebar.tsx:65-78` |
| FoldersSidebar skeleton state | loading | MISSING | `FoldersSidebar.tsx:79-83` |
| FoldersSidebar error state | error | MISSING | `FoldersSidebar.tsx:84-87` |
| Load-more button when >= 20 rows | success | MISSING | `NotesListClient.tsx:282-288` |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `u8-notes-list.spec.ts:64` |

### `/app/notes/[id]` (detail)

Source: `NoteDetailClient.tsx` (348 LOC).

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Skeleton while list pages | loading | PARTIAL | `u9-note-detail.spec.ts:22` |
| Not-found for missing id | empty | PARTIAL | `u9-note-detail.spec.ts:28` |
| Click "Back" link on not-found → `/app/notes` | success | MISSING | `NoteDetailClient.tsx:171-174` |
| Alert when list returns 500 | error | PARTIAL | `u9-note-detail.spec.ts:33` |
| Content tab renders | success | PARTIAL | `u9-note-detail.spec.ts:39` |
| Transcript tab renders when `transcript` populated | success | MISSING | `NoteDetailClient.tsx:269-273, 285-291` |
| Enhanced tab renders when `enhanced_content` populated | success | MISSING | `NoteDetailClient.tsx:274-278, 292-301` |
| Tab switching click | success | MISSING | `NoteDetailClient.tsx:264-302` |
| Enhancement prompt rendered when present | success | MISSING | `NoteDetailClient.tsx:296-298` |
| **Click Copy → navigator.clipboard + sonner toast** | success | MISSING | `NoteDetailClient.tsx:188-192` |
| **Click Export JSON** | success | MISSING | `NoteDetailClient.tsx:194-197` |
| **Click Export MD (with optional transcript + enhanced sections)** | success | MISSING | `NoteDetailClient.tsx:199-219` |
| **Click Delete → confirm → push `/app/notes`** | success | MISSING | `NoteDetailClient.tsx:127-137, 238-260` |
| Metadata: meeting note shows participants row | success | MISSING | `NoteDetailClient.tsx:328-333` |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `u9-note-detail.spec.ts:50` |

### `/app/notes/search`

Source: `NotesSearchClient.tsx`.

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Type-empty guidance copy when q.length < 2 | empty | PARTIAL | `u10-notes-search.spec.ts:29` |
| Skeleton while search stalled | loading | PARTIAL | `u10-notes-search.spec.ts:20` |
| No-matches copy | empty | PARTIAL | `u10-notes-search.spec.ts:34` |
| Alert when search returns 500 | error | PARTIAL | `u10-notes-search.spec.ts:39` |
| Seeded match appears | success | PARTIAL | `u10-notes-search.spec.ts:45` |
| Click result row → navigate to `/app/notes/[id]` | success | MISSING | `NotesSearchClient.tsx:168` |
| Submit form via Enter key → push `?q=…` | success | MISSING | `NotesSearchClient.tsx:73-81` |
| Click Clear → push `/app/notes/search` (no q) | success | MISSING | `NotesSearchClient.tsx:83-86, 116-118` |
| UUID-shape guard drops malformed id rows | success | MISSING | `NotesSearchClient.tsx:46, 91-94` (Plan 51-11c defense-in-depth) |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `u10-notes-search.spec.ts:56` |

### `/app/conversations` (list)

Source: `ConversationsListClient.tsx`.

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Skeleton rows | loading | PARTIAL | `u11-conv-list.spec.ts:22` |
| Empty card | empty | PARTIAL | `u11-conv-list.spec.ts:31` |
| Alert when list returns 500 | error | PARTIAL | `u11-conv-list.spec.ts:36` |
| N rows render | success | PARTIAL | `u11-conv-list.spec.ts:42` |
| Click row title → `/app/conversations/[id]` | success | MISSING | `ConversationsListClient.tsx:192-194` |
| Click Delete → confirm → `/api/conversations/delete` | success | MISSING | `ConversationsListClient.tsx:83-92, 197-220` |
| Cancel delete dialog | success | MISSING | `ConversationsListClient.tsx:212-214` |
| Load-more button | success | MISSING | `ConversationsListClient.tsx:227-233` |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `u11-conv-list.spec.ts:51` |

### `/app/conversations/[id]` (detail)

Source: `ConversationDetailClient.tsx`, `MessageBubble.tsx`.

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Skeleton while messages stalled | loading | PARTIAL | `u12-conv-detail.spec.ts:22` |
| "No messages" empty card | empty | PARTIAL | `u12-conv-detail.spec.ts:34` |
| Click "Back" on empty → `/app/conversations` | success | MISSING | `ConversationDetailClient.tsx:165-167` |
| Alert when messages returns 500 | error | PARTIAL | `u12-conv-detail.spec.ts:44` |
| Seeded messages render in thread (ascending) | success | PARTIAL | `u12-conv-detail.spec.ts:56` |
| Click "Load earlier messages" — additional page prepended | success | MISSING | `ConversationDetailClient.tsx:99-126, 239-251` |
| **Click Copy → navigator.clipboard + sonner toast** | success | MISSING | `ConversationDetailClient.tsx:173-183` |
| **Click Export JSON** | success | MISSING | `ConversationDetailClient.tsx:185-194` |
| **Click Delete → confirm → push `/app/conversations`** | success | MISSING | `ConversationDetailClient.tsx:87-97, 211-233` |
| Cancel delete dialog | success | MISSING | `ConversationDetailClient.tsx:227-229` |
| Click footer "Back" link → `/app/conversations` | success | MISSING | `ConversationDetailClient.tsx:257-259` |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `u12-conv-detail.spec.ts:66` |

### `/app/conversations/search`

Source: `ConversationsSearchClient.tsx`.

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Skeleton while search stalled | loading | PARTIAL | `u13-conv-search.spec.ts:22` |
| Empty q → type-a-query message | empty | PARTIAL | `u13-conv-search.spec.ts:31` |
| Alert when search returns 500 | error | PARTIAL | `u13-conv-search.spec.ts:36` |
| Match by title | success | PARTIAL | `u13-conv-search.spec.ts:42` |
| Click Clear → push `/app/conversations/search` | success | MISSING | `ConversationsSearchClient.tsx:76-79, 96-98` |
| Click result row → `/app/conversations/[id]` | success | MISSING | `ConversationsSearchClient.tsx:152-154` |
| Empty result list ("No matches" sub-card) | empty | MISSING | `ConversationsSearchClient.tsx:136-145` (rendered only when search succeeds with rows.length==0) |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `u13-conv-search.spec.ts:49` |

### `/admin` (index)

Source: `apps/web/src/app/(admin)/admin/page.tsx` → `AdminIndex.tsx`.

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Renders title + lede + read-only status alert + two cards | success | MISSING | `AdminIndex.tsx:42-82`; no e2e spec targets `/admin` index (only `a2-observability` and `a3-config`) |
| Sidebar nav (Observability + Configuration) clicks | success | MISSING | `AdminShell.tsx:23-29, 43-60` |
| Theme switcher works on admin shell | success | MISSING | `AdminShell.tsx:68` |

### `/admin/observability`

Source: `ObservabilityClient.tsx`.

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Basic-auth header reaches container | success | PARTIAL | `a2-observability.spec.ts:67` |
| Heading + Open Grafana button + 6 dashboard cards | success | PARTIAL | `a2-observability.spec.ts:73` |
| Four quick-link list items | success | PARTIAL | `a2-observability.spec.ts:90` |
| All dashboard anchors `target=_blank rel=noopener noreferrer` | success | PARTIAL | `a2-observability.spec.ts:102` |
| `NEXT_PUBLIC_GRAFANA_BASE_URL` missing → destructive Alert | error | MISSING | `ObservabilityClient.tsx:100-117` |
| `safeExternalHref()` rejects `javascript:` URLs at render | success | MISSING | `ObservabilityClient.tsx:81-93` (Plan 51-11 web HIGH defence-in-depth) |
| Click "Open Grafana" — opens in new tab | success | MISSING | `ObservabilityClient.tsx:136-141` |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `a2-observability.spec.ts:116` |

### `/admin/config`

Source: `ConfigClient.tsx`.

| UC | State | E2E status | Spec ref / blocker |
|----|-------|-----------|--------------------|
| Basic-auth header reaches container | success | PARTIAL | `a3-config.spec.ts:25` |
| Both queries pending → two Skeleton tables | loading | PARTIAL | `a3-config.spec.ts:31` |
| `/api/stt-config` 500 → destructive Alert + Retry | error | PARTIAL | `a3-config.spec.ts:47` |
| Both Cards populate from seeded defaults | success | PARTIAL | `a3-config.spec.ts:59` |
| Click Refresh → invalidates both queries | success | MISSING | `ConfigClient.tsx:85-88, 113-117` |
| Click Retry on error → both refetch | success | MISSING | `ConfigClient.tsx:90-93, 130-132` |
| Click "Docs: how to override" → `/docs/litellm-target-spec.md` opens new tab | success | MISSING | `ConfigClient.tsx:108-113` |
| `note-recording-config` 500 only → still shows STT card | partial-error | MISSING | `ConfigClient.tsx:96` — only STT-500 is tested |
| Axe WCAG 2.2 AA clean | success | PARTIAL | `a3-config.spec.ts:91` |

---

## Cross-cutting UCs

### Locale toggle (LanguageSwitcher)

`LanguageSwitcher.tsx:42-65` mounted in `AppShell.tsx:78` (every authed page) and in `(public)/layout.tsx` over the AuthShell right column.

| UC | E2E status | Spec ref |
|----|-----------|----------|
| Visible on every authed page | MISSING | `AppShell.tsx:78`; only `/app` tested implicitly |
| Visible on every public page | MISSING | `(public)/layout.tsx`; never asserted at component level |
| Click EN button when active → no-op (early return) | MISSING | `LanguageSwitcher.tsx:31` |
| Click RU button → POST `/api/locale` + `router.refresh()` | COVERED | `100-acceptance/full-flow.spec.ts:148-176` (with `expectNoBrowserErrors`) |
| Persistence across reload | COVERED | `i18n-russian.spec.ts:47` |
| `aria-pressed` reflects active locale | MISSING | `LanguageSwitcher.tsx:53` |
| RU labels rendered on `/sign-in` | COVERED | `i18n-russian.spec.ts:15` |
| RU labels rendered on every other page | MISSING | only `/sign-in` is tested in Russian |

### Theme switcher (ThemeSwitcher)

`theme-switcher.tsx` mounted in `AppShell.tsx:79` and `AdminShell.tsx:68`.

| UC | E2E status | Spec ref |
|----|-----------|----------|
| Toggle button visible on every authed page | MISSING | `AppShell.tsx:79` |
| Toggle button visible on every admin page | MISSING | `AdminShell.tsx:68` |
| Open dropdown → 3 options (Light/Dark/System) | MISSING | `theme-switcher.tsx:32-44` |
| Click Light → `<html data-theme=light>` | PARTIAL | `100-acceptance/full-flow.spec.ts:178-213` flips, but doesn't assert all three options |
| Click Dark → flips | PARTIAL | same |
| Click System → resolves from OS preference | MISSING | `theme-switcher.tsx:41-43` |
| Persistence across reload (localStorage) | COVERED | `100-acceptance/full-flow.spec.ts:197-204` |

### Sign-out

| UC | E2E status | Spec ref |
|----|-----------|----------|
| Click sign-out button in `AppShell` header → push `/sign-in` | COVERED | `100-acceptance/full-flow.spec.ts:217-228` |
| API `POST /api/auth/sign-out` directly clears session | PARTIAL | `99-cross-screen-smoke.spec.ts:86` (no `expectNoBrowserErrors`) |
| Localized sign-out label in RU | COVERED | `100-acceptance/full-flow.spec.ts:163-176` |

### Authentication middleware guard

| UC | E2E status | Spec ref |
|----|-----------|----------|
| Signed-out `/app/*` → `/sign-in?from=` | PARTIAL | `05-auth-middleware.spec.ts:18` |
| Signed-out `/admin/*` → no redirect (Traefik gates) | PARTIAL | `05-auth-middleware.spec.ts:26` |
| Signed-out `/sign-in` → no redirect loop | PARTIAL | `05-auth-middleware.spec.ts:42` |
| Post-sign-out `/app` → redirect | COVERED | `100-acceptance/full-flow.spec.ts:230-239` |

### Session expiry → token rotation

| UC | E2E status | Spec ref |
|----|-----------|----------|
| Better Auth `set-auth-token` rotation | PARTIAL | CJM `session-refresh.feature` — not a UI test |
| Expired session triggers re-auth on next mutation | MISSING | No web spec |

### Network error → Retry button

Pattern shared by `UsageDashboardClient`, `SessionsTable`, list/detail clients × 6.

| UC | E2E status |
|----|-----------|
| Retry button **rendered** in error state | PARTIAL on all 9 screens (`u4`, `u5`, `u6`, `u7`, `u8`, `u9`, `u10`, `u11`, `u12`, `u13`, `a3`) |
| Retry button **clicked** → refetch succeeds | MISSING on all 11 surfaces |

### AuthShell footer dead links

`AuthShell.tsx:66-78` ships three `Link href="#"` for Status / Docs / GitHub. **MISSING (and a UX bug worth filing) — these go nowhere in production.**

### Sonner toast surface

`NoteDetailClient.tsx:190`, `TranscriptionDetailClient.tsx:176`, `ConversationDetailClient.tsx:181` all rely on `toast.success(...)`. No e2e spec asserts the toast renders. **MISSING ×3.**

### `<Toaster>` mount + accessibility region

Not enumerated above but worth flagging — if the toaster is unmounted, all three Copy buttons silently lose UX feedback. Verify mount location and add a smoke assertion.

---

## Recommended phase carve-out

Each ≤ 8 hours of executor work; ordered by user-visibility risk.

### Phase 55-01 — Close BLOCKED + highest-leverage destructive flows (~7h)

**Acceptance criterion:** zero BLOCKED UCs remain in this audit; destructive flows on `/app/account` are end-to-end green with `expectNoBrowserErrors`.

UCs:
- BUG-54-PRD-RESET-UI-MISSING — build `/forgot-password` + `/reset-password` UI surfaces wired to existing API. **Unblocks 1 UC.**
- DeleteAccountDialog full flow (open → mismatch disabled → match → confirm → push `/sign-in` → guard redirect). **5 UCs.**
- SessionsTable revoke + revoke-others click-throughs. **2 UCs.**

### Phase 55-02 — Auth-page interactive elements (~6h)

**Acceptance criterion:** every interactive control on `/sign-in` and `/sign-up` exercised end-to-end.

UCs:
- Resend-verification CTA (idle → sending → sent). **3 UCs.**
- Eye-toggle show/hide password (`SignInForm`). **1 UC.**
- Remember-device checkbox passed through to `rememberMe`. **1 UC.**
- Password strength meter across all four bands. **4 UCs.**
- AuthShell footer links wired to real targets (or remove). **3 UCs.**
- Generic sign-up error branch. **1 UC.**

### Phase 55-03 — Setup wizard hard-coverage (~7h)

**Acceptance criterion:** complete fresh-server setup flow exercised end-to-end with `expectNoBrowserErrors`, including warning + error branches.

UCs:
- Identity / Workspace / Review section advance (IntersectionObserver step indicator). **1 UC.**
- Submit 201 → `/admin`. **1 UC.**
- Submit 200 (race-loser) → `/admin`. **1 UC.**
- Submit generic error. **1 UC.**
- Submit with `tenant_rename_failed` warning. **1 UC.**
- Timezone hydration parity guard regression. **1 UC.**
- Per-field Zod localized errors. **3 UCs (name, email, password).**

### Phase 55-04 — Detail-screen export/copy/delete trio (~8h)

**Acceptance criterion:** all Copy / Export JSON / Export MD / Delete buttons on every detail screen are clicked end-to-end and assert side effects (clipboard write, blob download via `download` attribute, list invalidation).

UCs:
- NoteDetail × 4 buttons + tab switching + meeting-participants row. **6 UCs.**
- TranscriptionDetail × 4 buttons + back link. **5 UCs.**
- ConversationDetail × 3 buttons + load-earlier + back. **5 UCs.**

### Phase 55-05 — List-screen interactivity (~7h)

**Acceptance criterion:** every row action (click → navigate, Delete → confirm/cancel, Load-more) exercised on all four list screens; folder-sidebar filter exercised on `/app/notes`.

UCs:
- Row-click navigation × 4 screens. **4 UCs.**
- Delete + Cancel dialogs × 4 screens. **8 UCs.**
- Load-more × 4 screens. **4 UCs.**
- FoldersSidebar select/All-notes/skeleton/error. **4 UCs.**
- Search submit / Clear / result-click × 2 search screens. **6 UCs.**

### Phase 55-06 — Admin + cross-cutting (~6h)

**Acceptance criterion:** `/admin` index, ObservabilityClient env-missing branch, ConfigClient refresh/retry/docs-link, every authed-page locale-toggle visibility.

UCs:
- AdminIndex render + sidebar clicks. **3 UCs.**
- ObservabilityClient env-missing alert + safeExternalHref rejection. **2 UCs.**
- ConfigClient refresh + retry + docs-link + partial-error branch. **4 UCs.**
- LanguageSwitcher visible on every authed page (assert each). **2 UCs.**
- ThemeSwitcher visible on every authed + admin page. **2 UCs.**
- Retry-button clicked across all 11 surfaces (drive via consolidated helper). **11 UCs.**

### Phase 55-07 — OIDC click-through + AuthShell footer (~3h)

**Acceptance criterion:** OIDC provider click triggers `signIn.social` redirect; AuthShell footer links resolve.

UCs:
- OIDC button click per provider. **3 UCs (google/github/oidc-sso).**
- Pending state disables siblings. **1 UC.**
- AuthShell footer Status / Docs / GitHub real targets. **3 UCs.**

---

## Backlog deltas to file (new entries for `.planning/deferred-items.md`)

Each one-liner; group these under a new `### Phase 55 — UC coverage backlog` section.

1. **BUG-55-AUTHSHELL-FOOTER-DEAD-LINKS** — `AuthShell.tsx:66-78` ships three `Link href="#"` Status/Docs/GitHub anchors that go nowhere in production.
2. **BUG-55-FOLDER-SIDEBAR-NO-FOLDER-CLICK-COVERAGE** — `FoldersSidebar.tsx:91-108` click handler has no e2e test; D-UX5 constitutional regression risk.
3. **BUG-55-DELETE-ACCOUNT-UNTESTED** — `DeleteAccountDialog.tsx` (irreversible destructive flow) has zero e2e coverage.
4. **BUG-55-SESSION-REVOKE-UNTESTED** — `SessionsTable.tsx` revoke + revoke-others buttons have no click-through coverage.
5. **BUG-55-OIDC-BUTTON-CLICK-UNTESTED** — `OidcButtons.tsx:50-61` `signIn.social` call never invoked from a web spec; backend `oidc-providers.feature` does not cover UI click path.
6. **BUG-55-DETAIL-EXPORTS-UNTESTED** — Copy / Export JSON / Export MD buttons on Note, Transcription, Conversation detail screens (9 buttons total) have no e2e coverage.
7. **BUG-55-SETUP-WIZARD-NO-HAPPY-PATH** — `/setup` form has only an axe-skip-when-completed spec; happy path through Identity → Workspace → Review → 201 → `/admin` is never exercised.
8. **BUG-55-SETUP-TENANT-RENAME-WARNING-UNTESTED** — `SetupForm.tsx:249-255` warning branch has no spec.
9. **BUG-55-RESEND-VERIFICATION-UNTESTED** — `SignInForm.tsx:95-105, 126-151` `EMAIL_NOT_VERIFIED` resend flow has no e2e coverage.
10. **BUG-55-EYE-TOGGLE-UNTESTED** — `SignInForm.tsx:211-222` password show/hide has no e2e coverage.
11. **BUG-55-REMEMBER-DEVICE-UNTESTED** — `SignInForm.tsx:228-246` checkbox passthrough to `rememberMe` has no e2e coverage.
12. **BUG-55-PASSWORD-STRENGTH-METER-UNTESTED** — `SignUpForm.tsx:54-64` four-band meter has only unit coverage; visual bands never asserted in playwright.
13. **BUG-55-OBSERVABILITY-ENV-MISSING-UNTESTED** — `ObservabilityClient.tsx:100-117` destructive Alert branch (operator-facing) has no spec.
14. **BUG-55-NO-EXPECTNOBROWSERERRORS-IN-U-SPECS** — every `u*.spec.ts` (23 files) lacks `expectNoBrowserErrors`; only `full-flow.spec.ts`, `p53-signup-smoke.spec.ts`, `100-fullflow-signup-verify-signin.spec.ts`, and `i18n-russian.spec.ts` enforce console-clean. Recommend a sweep adding the assertion to each.
15. **BUG-55-LOAD-MORE-UNTESTED** — list pagination ("Load more" on trx/notes/conv lists, "Load earlier" on conversation detail) never exercised in any spec.
16. **BUG-55-RETRY-BUTTONS-UNCLICKED** — 11 surfaces render Retry buttons in error state; zero specs click any of them.
17. **BUG-55-SONNER-TOAST-UNTESTED** — `toast.success(...)` calls on Note/Trx/Conv detail Copy buttons never asserted; if `<Toaster>` unmounts silently, UX feedback is lost.
18. **BUG-55-LANGUAGE-SWITCHER-PUBLIC-LAYOUT-UNTESTED** — only `/sign-in` is rendered in Russian; the same switcher must work on `/sign-up`, `/verify-email`, `/setup`, and all admin pages.

---

## Sources

All citations are file:line in the current working tree. No external dependencies consulted.

Primary inputs:
- `apps/web/src/app/**` — 18 page routes + 4 layouts
- `apps/web/src/components/screens/**` — 27 screen components, 5,015 LOC total
- `apps/web/tests/e2e/*.spec.ts` — 23 specs
- `apps/web/tests/e2e/100-acceptance/full-flow.spec.ts` — the one true console-clean walk-through (~6 routes)
- `tests/e2e-cjm/features/*.feature` — 22 Gherkin features (backend-leaning; only `locale-switch.feature` and `oidc-providers.feature` touch web UI)
- `.planning/deferred-items.md` — BLOCKED items source

## Metadata

**Confidence breakdown:**
- UC enumeration: HIGH — every interactive `<Button>`, `<Input>`, `<Link>`, `<AlertDialog>`, dropdown trigger in every screen component was read and cited.
- Coverage classification: HIGH — every COVERED claim cites a spec that uses `expectNoBrowserErrors`; every PARTIAL/MISSING claim was verified by grep across the entire e2e + CJM tree.
- Backlog deltas: HIGH — each delta corresponds to a concrete file:line gap.

**Valid until:** 2026-06-19 (30 days) or any change touching `apps/web/src/components/screens/**` or `apps/web/tests/e2e/**`.

**Research date:** 2026-05-19
