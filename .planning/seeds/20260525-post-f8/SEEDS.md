# Post-F8 seeds — 2026-05-25

Bugs/techdebt filed by operator-peer `ykoolfs5` after F8 GREEN on stage+prod.
User отвалился до решения по приоритету. Seeds живут здесь до user mandate.

## SEED-F8-UX — Expired-token verify-email UX

**Severity**: HIGH (user-facing — пользователь явно жаловался "уродская ошибка")
**Surface**: web-flow on expired verification link
**Triggered**: user clicked expired link in browser 2026-05-25 ~18:08 UTC,
saw raw JSON `{"error":"Нет подтверждённой сессии для этого запроса подтверждения"}`

### Reproduction

1. Sign up via `https://openwhispr.yambr.com/sign-up`
2. Wait >1h for Better Auth verification token to expire (default `expiresIn`
   in `apps/api/src/auth.ts:587` — no explicit value, defaults to 3600 sec)
3. Click verify-email link from inbox in a browser
4. Result: 302 chain ends at `/api/auth/verify-email-complete` which returns
   `401 application/json { "error": "..." }` directly to the browser
5. User sees raw JSON envelope, not an error page

### Root cause

`apps/api/src/routes/verify-email-complete.ts:130` throws
`AuthError("VERIFY_EMAIL_COMPLETE_NO_SESSION", ...)` when Better Auth's
verify-email handler did NOT set a session cookie (token expired → handler
silently 302s without `setSessionCookie`). Central error handler emits the
canonical `{error: ...}` envelope.

This is the canonical API contract envelope, perfectly correct for an
API consumer — but wrong for a browser navigation. The route should
detect the request comes from a browser (Sec-Fetch-Site or Accept
header) and 302 to `/sign-in?error=link-expired` with a banner instead.

### Proposed fix

- In `verify-email-complete.ts` handler, BEFORE throwing AuthError, check:
  - `req.headers.accept?.includes("text/html")` OR
  - `req.headers["sec-fetch-site"] === "none"` (top-level navigation)
- If true → `reply.redirect("/sign-in?error=link-expired", 302)` (web)
- Else → throw AuthError as now (API consumer)

- Add `signin.error-link-expired` i18n key (en + ru) — banner on
  `/sign-in?error=link-expired`

- Same treatment for the `?error=` Better Auth passthrough param (line 84)
  — currently throws if the user lands here AFTER Better Auth's
  verify-email error path

### Out of scope
- Tuning Better Auth `expiresIn` (1h → 24h?) — separate discussion

### Tests

- New `verify-email-complete.test.ts` cases:
  - "expired token + Accept: text/html → 302 /sign-in?error=link-expired"
  - "expired token + Accept: application/json → 401 envelope"
  - "?error=... + Accept: text/html → 302 /sign-in?error=<code>"
- New web `SignInForm.test.tsx` case for `?error=link-expired` banner

---

## SEED-F-LOCALE — Web language switcher no-op

**Severity**: MEDIUM (user-facing; bilingual launch promise)
**Surface**: `apps/web/src/components/screens/auth/SignInForm.tsx` (and
sibling LanguageSwitcher) on `/sign-in`

### Reproduction (peer's MCP playwright trace)

1. Open `https://openwhispr.yambr.com/sign-in` (cookie jar empty)
2. Click "Русский" button
3. POST /api/locale → **200 OK** (verified 13 times)
4. `document.documentElement.lang` stays `"en"`
5. `document.cookie` empty — no `NEXT_LOCALE=ru` cookie set
6. Body text stays English ("Sign in to OpenWhispr")

### Hypotheses (peer-listed, need verification)

- POST /api/locale handler doesn't emit `Set-Cookie` (or cookie filtered
  at ingress — but peer says Envoy Gateway not modifying cookie domain)
- Frontend LanguageSwitcher click doesn't call `router.refresh()` /
  `window.location.reload()` after the 200 response
- SSR sign-in page uses a different source of truth (Better Auth
  `user.locale` field) which is unavailable for anonymous /sign-in
- Sign-in page hardcoded `lang="en"` on server-render; client `<LanguageSwitcher>`
  is not reactive enough to flip it client-side

### Evidence dump from peer (2026-05-25 18:53 UTC, MCP playwright)

Anonymous client, no prior cookies, `https://openwhispr.yambr.com/sign-in`
served by api Pod `ow-openwhispr-server-api-5996979d88-7247g` (chart 1.0.8,
api v1.0.5).

Request:
```http
POST /api/locale HTTP/2
Content-Type: application/json
Body: {"locale":"ru"}
```

Response:
```http
HTTP/2 200
cache-control: no-store
content-language: ru
content-length: 15
content-type: application/json; charset=utf-8
x-ratelimit-limit: 10
x-ratelimit-remaining: 9

{"locale":"ru"}
```

**Critical finding — NO `Set-Cookie` header in response.** The endpoint
just echoes the payload. Zero persistence.

Before vs After in same JS context:
- `document.documentElement.lang` — `"en"` → `"en"` (no change)
- `document.cookie` — `""` → `""` (empty)
- body text — English → English (no change)

Pure no-op: server returns 200 echo, client does not call
`router.refresh()` / `window.location.reload()` / write a cookie itself.

### Root-cause hypothesis (confirmed by evidence above)

**Both** layers are broken:

1. **Server** — `POST /api/locale` does NOT emit `Set-Cookie`. Should
   include something like `Set-Cookie: NEXT_LOCALE=ru; Path=/;
   Max-Age=31536000; SameSite=Lax; Secure; HttpOnly=false` so SSR on the
   next page render gets the right `<html lang>` + bundle.

2. **Client** — `LanguageSwitcher.onClick` after `fetch('/api/locale')`
   does NOT call `router.refresh()` (Next.js App Router) or
   `window.location.reload()`. So even if (1) is fixed and a cookie
   lands, SSR re-render is not triggered.

Both layers must be fixed atomically. The peer is correct that an
alternative client-side-only path (i18next.changeLanguage + reactive
provider) would skip the reload at the cost of dropping SSR locale
parity — defer that choice to the user when triaging this seed.

### Investigation steps (now reduced)

1. Read `apps/api/src/routes/locale.ts` — confirm it does NOT call
   `reply.setCookie(...)`. Add Set-Cookie emission.
2. Read `apps/web/.../LanguageSwitcher.tsx` — confirm onClick does NOT
   refresh after fetch. Add `router.refresh()` or
   `window.location.reload()` based on user preference.
3. Read `apps/web/src/middleware.ts` — confirm locale negotiation reads
   the cookie name we're about to set.
4. Read `apps/web/src/app/(public)/layout.tsx` — `<html lang={...}>`
   source-of-truth.
5. Reproduce locally; add e2e test (real browser click) for the full
   round-trip.

### Tests

- E2E: real browser click on LanguageSwitcher → cookie set + page text
  in Russian
- Unit: LanguageSwitcher mock-fetch + assertion that `router.refresh` /
  navigation re-fetch is triggered

---

## SEED-37 — worker CJS `import.meta.url` undefined

**Severity**: LOW (workaround in place)
**Surface**: `apps/worker/src/i18n/template-renderer.ts:72`

### Current state

In the worker CJS bundle (tsup output), `import.meta.url` is undefined,
so the template-renderer's path-resolution-relative-to-source fails.

Operator workaround: `LOCALES_DIR=/app/apps/worker/dist/i18n/locales`
env hardcoded in their overlay values.

### Real fix candidates

- Switch worker to ESM-only output (`format: ["esm"]` in tsup config) —
  Node 24 fully ESM-capable; worker is a long-running process, not a
  library. Audit any imports that require CJS interop.
- Use `__dirname` via tsup CJS shim if ESM switch is risky
- Compute LOCALES_DIR from `process.cwd()` / `process.argv[1]` at boot
  with a clear loud-fail if not findable

### Tests

- Unit: template-renderer can resolve locale path under CJS bundle
- Integration: real worker container boot does not require LOCALES_DIR env

---

## SEED-47 — Resend yambr.com domain verification

**Severity**: LOW (cosmetic + plus-addressing testing-mode breakage)
**Surface**: SMTP_FROM env in operator overlays

### Current state

`SMTP_FROM=onboarding@resend.dev` — Resend dev sandbox sender. Looks
unbranded in prod. Resend testing-mode breaks plus-addressing
(`yambroskinz+test123@gmail.com` rejected).

### Fix

1. Server-side: ensure full Resend API key (not sandbox restricted) is
   provisioned for `openwhispr.yambr.com` Resend project
2. Operator-side (peer): add DKIM + SPF records in Cloudflare DNS for
   `yambr.com`
3. Flip `SMTP_FROM=no-reply@yambr.com` in overlay values, observe one
   verification email landing with proper FROM + no plus-addressing
   rejection

This is mostly operator-side; server-side action = peer mention of
Resend API key auth context if not provisioned.

---

## Triage notes (when user re-engages)

User mandate from earlier session: "F8 only, design на твоё усмотрение, делай".
Mandate scope closed when F8 GREEN. These seeds need NEW user mandate —
do NOT pull into a phase autonomously.

Recommended ordering:
1. **SEED-F8-UX** (user явно жаловался — they care about this)
2. **SEED-F-LOCALE** (bilingual launch promise; mostly client-side)
3. **SEED-37** (no user pressure; cleanup)
4. **SEED-47** (operator can drive when ready)
