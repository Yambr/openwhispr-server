# Phase 7: Frontend UI-SPEC — Research

**Researched:** 2026-05-12
**Domain:** Frontend specification artifact (markdown deliverable + TypeScript spec linter), targeting Next.js 15 App Router + React 19 + Tailwind 4 + shadcn/ui v2 + TanStack Query 5 + Better Auth 1.x + i18next + Recharts
**Confidence:** HIGH on stack versions and patterns (verified via npm registry + official docs); MEDIUM on copy-key / linter conventions (project-specific, no industry "blessed" example); HIGH on WCAG/accessibility tooling.

## Summary

Phase 7's deliverable is **two markdown UI-SPEC files + a TypeScript spec linter**, not runtime code. The research therefore splits into two streams:

1. **Spec authoring conventions** — how to structure 15 screens × 9 required subsections in a way that (a) is unambiguous for downstream implementers and (b) is mechanically lintable. The literature for "production UI specs" is thin (most companies treat them as internal artifacts); the pragmatic shape is a Markdown-with-front-matter template per screen, ASCII wireframes as fenced code blocks, and a lint that walks mdast + greps the routes directory.

2. **Target-stack canonical patterns** — the libraries the UI-SPEC names are the ones the executor will install in Phase 7 (or Phase 8, depending on planner decision). Every version is verified against npm registry on 2026-05-12. Tailwind 4 + shadcn/ui v2 + React 19 + Next.js 15 are the new "blessed" combination as of Feb 2025; the official shadcn CLI is `pnpm dlx shadcn@latest` (the legacy `shadcn-ui` package is deprecated). Better Auth React client provides `useSession()` with `refetch()`, and exposes `list-sessions` / `revoke-session` / `revoke-other-sessions` endpoints at `/api/auth/*` already mounted via the `better-auth-handler.ts` catch-all in this codebase.

**Primary recommendation:** Author the two UI-SPEC files using a strict per-screen template (front-matter for machine-readable metadata + nine subsections in fixed order + ASCII wireframe in a `text` fenced block). Build the linter on `unified` + `remark-parse` (mdast walker) rather than regex — it produces structured diagnostics with line numbers and is the standard in the markdown ecosystem. Defer the Next.js scaffold (`apps/web/`) to Phase 8; Phase 7 ships specs + linter only, keeping the phase atomic and the verifier surface small.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Steering rule (D-S1):** "Толкаемся от спеки бэка." When design diverges from existing API: (a) simplify the screen to fit the API, or (b) re-engage Claude Design to update the mockup, or (c) drop the feature into Phase 7.x backlog. **Never** add a new API endpoint in Phase 7 to back-fill a design assumption.

**Admin scope (D-API4, D-API5):**
- A1 Audit log viewer DROPPED from v1 (no backing `/api/admin/audit/list` endpoint). Admin v1 = **2 screens**: A2 Observability + A3 Config.
- A3 Config: "Effective env" block REMOVED — no env-summary endpoint, security hot zone. A3 v1 = STT config table (`GET /api/stt-config`) + Note-recording config table (`GET /api/note-recording-config`).

**End-User resource alignment (D-API1, D-API2, D-API6):**
- U7 Transcription detail = flat transcript paragraphs; no word-level timestamps (API returns `text`, `raw_text`, `word_count`, `audio_duration_ms`, `provider`, `model`, `language`, `status`, `created_at` only). Claude Design's `00:00 / 00:42 / 02:18` markers are decorative.
- U5 Sessions list uses Better Auth handler routes (already mounted under `/api/auth/*`): `GET /api/auth/list-sessions`, `POST /api/auth/revoke-session`, `POST /api/auth/revoke-other-sessions`.
- U4 "Latest activity" feed REMOVED — no `/api/activity/recent` endpoint and steering rule forbids inventing one. U4 v1 = 4 KPI cards + Requests/day line chart + Audio-minutes/day bar chart + By-provider breakdown.

**UX scope (D-UX1, D-UX2, D-UX3, D-UX4, D-UX5):**
- Email/password KEPT in v1 (U1/U2/U3). OIDC buttons alongside (Google / GitHub / "Continue with SSO" — generic label for LDAP-via-OIDC bridge).
- Password reset DEFERRED to Phase 7.x. "Forgot password?" link in U1 disabled in v1 (static text or placeholder page).
- PAK web UI DEFERRED to Phase 7.x. Desktop client owns PAK creation/rotation/revoke.
- LDAP via OIDC bridge only (Better Auth has no native LDAP plugin). UI label = "Continue with SSO".
- Folders read-only in web (U8 sidebar). Desktop owns folder writes.

**Artifact structure (D-ART1..D-ART7):**
- D-ART1 — Two markdown files: `UI-SPEC-admin.md` + `UI-SPEC-end-user.md`, 15–25 pages combined.
- D-ART2 — Wireframes = ASCII block-level + `See visual: design/<file>.jsx#<function>` reference line per screen.
- D-ART3 — Design assets vendored under `.planning/phases/07-frontend-ui-spec/design/` (already done).
- D-ART4 — Copy-key schema: `{surface}.{screen}.{section}.{element}.{prop}` (5-level dotted hierarchy). JSON bundles: `apps/web/src/locales/{en,ru}/{admin,end-user,common}.json`. Russian deferred to Phase 10.
- D-ART5 — shadcn inventory: per-screen list + appendix with `pnpm dlx shadcn@latest add <name>` commands.
- D-ART6 — Shared cross-link appendix in both files: design tokens, breakpoint matrix, i18n key index, API endpoint index.
- D-ART7 — `tools/lint-ui-spec.ts` validates: every screen has all 9 required subsections; every API endpoint referenced exists in `apps/api/src/routes/`; every copy key unique across both files; every `See visual:` reference points to a real JSX function; ASCII wireframes parse as monospace.

### Claude's Discretion

- Exact shadcn variant tokens (`Button variant="ghost"` vs `kind="ghost"`) — picker chooses based on shadcn v2 canonical naming.
- Exact English string text within each copy key.
- Order of screen sections within each UI-SPEC file (alphabetical-by-route as default).

### Deferred Ideas (OUT OF SCOPE)

- **Phase 7.x:** U14/U15 password reset, U16 PAK manager web UI, A1 audit log viewer + backing `/api/admin/audit/list` endpoint.
- **Phase 7b:** Tenants/Users CRUD, IdP/LiteLLM config UIs (would also need admin-cross-tenant API).
- **Phase 6.x (carry-over):** API-tier Fastify pino logger wiring; virtual-key-rotation dead-code cleanup.
- **Out of repo entirely:** MCP server integration, Web transcribe/reason/realtime UI (desktop owns).
- **Re-engage Claude Design (post-research, before execute):** U1 "Forgot password" disabled state, A3 vertical balance after removing Effective env, U4 grid balance after removing activity feed.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-SPEC-01 | UI-SPEC.md for Operator/Admin Console (scoped to A2 Observability + A3 Config per D-API4/D-API5) | Section "Standard Stack" + "Architecture Patterns" — Next.js 15 RSC layout + Better Auth role middleware pattern enables `/admin/*` gate; "API endpoint index" appendix shape documented in Section 1 below. |
| UI-SPEC-02 | UI-SPEC.md for End-User Self-Service (U1–U13, scoped per D-API1/D-API2/D-API6/D-UX1..5) | Section "TanStack Query 5 patterns" + "Better Auth React integration" — `useSession()` + `list-sessions` endpoint already exposed via `better-auth-handler.ts` catch-all in this repo; query-key conventions documented. |
| UI-SPEC-03 | Target Next.js 15 + React 19 + Tailwind 4 + shadcn/ui v2 + TanStack Query 5; WCAG 2.2 AA; responsive (mobile + tablet + desktop); light + dark theme; component inventory; design tokens | Section "Standard Stack" verifies every version, Section "WCAG 2.2 AA Conformance" enumerates checklist, Section "Performance budgets" details how to hold ≤200KB gzipped per route, Section "shadcn/ui v2 CLI conventions" documents primitive inventory pattern. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

The following constitutional directives apply to this phase and supersede any conflicting research recommendation:

- **Strict TDD** — `tools/lint-ui-spec.ts` MUST be developed RED → GREEN → REFACTOR. Failing tests against missing sections, fake endpoints, duplicate keys, malformed wireframes precede production code in the same commit.
- **Per-phase coverage floor ≥ 90/90/90/90** on lines/branches/functions/statements for the linter's TypeScript code (the markdown specs themselves are non-code artifacts and exempt — verifier reports gaps against the linter only).
- **E2E mandatory if user-visible** — Phase 7 deliverable is markdown + a build-time linter; no runtime/user-visible surface ships from this phase. Therefore an e2e Docker-stack test is NOT required for Phase 7. An e2e gate fires only when `apps/web/` lands (Phase 8 or later).
- **No mocks of internal logic** — linter unit tests use real markdown fixtures (e.g., `tests/fixtures/ui-spec/*.md`), not stub mdast trees.
- **GitHub Actions** — extend `.github/workflows/ci.yml` to run `pnpm lint:ui-spec` on every PR touching `.planning/phases/07-frontend-ui-spec/UI-SPEC-*.md` OR `tools/lint-ui-spec.ts` OR `apps/api/src/routes/**`.
- **English-only source artifacts** — UI-SPEC body in English; Russian deferred to Phase 10 per D-ART4. Copy-key VALUES carry the English string only in v1.
- **Maximum test automation** — linter property-tests endpoint extraction (no manual route list maintenance) and copy-key uniqueness (cross-file scan).

## Standard Stack

> All versions verified against `npm view <pkg> version` on 2026-05-12.
> Phase 7 LOCKS Next.js 15.x (not 16.x) per SPEC.md tech stack pin — Next.js 16 just GA'd (16.2.6 latest) but the phase was scoped against 15.

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | **15.x latest minor** (15.5+) | App Router framework, RSC/CSR boundary, route-level code splitting | Specified by SPEC.md; React 19 stable inside 15.1+; App Router is the canonical routing model in 2026. [VERIFIED: nextjs.org/blog/next-15] |
| React | **19.x** (19.2.6 latest) | UI runtime; required by Next.js 15.1+ as stable | App Router uses React 19; Server Components stable. [VERIFIED: npm registry] |
| TypeScript | strict mode | Type safety per CLAUDE.md constitutional rule | Matches `apps/api` and `packages/*` config. [VERIFIED: CLAUDE.md] |
| Tailwind CSS | **4.3.0** | Utility-first styling; required by shadcn/ui v2 | shadcn/ui v2 (Feb 2025 release) requires Tailwind v4; CSS-first config replaces `tailwind.config.js`. [VERIFIED: ui.shadcn.com/docs/tailwind-v4] |
| shadcn/ui | **v2 (CLI: `shadcn@latest`)** | Copy-into-repo component primitives, NOT an npm dep | Canonical React component recipe in 2026; `pnpm dlx shadcn@latest init` initializes for Tailwind 4 + React 19 automatically. [VERIFIED: ui.shadcn.com/docs/changelog/2025-02-tailwind-v4] |
| TanStack Query | **5.100.10** | Server-state cache, mutations, hierarchical key invalidation | De facto standard for React data fetching; replaces hand-rolled `useEffect` + `fetch`. [VERIFIED: npm registry] |
| Better Auth (react client) | **1.6.10** | `useSession()` hook + client-side auth helpers (sign-in, sign-out, list-sessions, revoke-session) | Symmetric with `packages/auth/` server-side install (Phase 2). [VERIFIED: npm registry; better-auth.com/docs/concepts/session-management] |
| TanStack Table | **8.21.3** | Headless table model for U6 / U8 / U11 keyset-paginated lists | Headless API composes cleanly with shadcn `Table` primitive (presentation) vs TanStack (data). [VERIFIED: npm registry] |
| react-hook-form | **7.75.0** | Form state + validation on U1 sign-in, U2 sign-up, U3 verify, U5 account | Pairs with `@hookform/resolvers` + zod for schema-driven forms; minimal re-renders. [VERIFIED: npm registry] |
| zod | **4.4.3** | Schema validation; shares `packages/wire-schemas` with the API | Zod v4 (released 2025) used by `packages/wire-schemas` already. [VERIFIED: npm registry] |
| Recharts | **3.8.1** | U4 usage dashboard charts (line + bar + breakdown) | Default per SPEC.md; SSR-friendly SVG output. ~150KB ungzipped. [VERIFIED: npm registry; pkgpulse.com/guides/recharts-v3-vs-tremor-vs-nivo-react-charting-2026] |
| date-fns | **4.1.0** | Date formatting (created_at, audio_duration) — tree-shakable per-function imports | Modular imports keep bundle slim. [VERIFIED: npm registry] |
| i18next | **26.1.0** | Core i18n runtime | Symmetric with `packages/i18n/` server-side install. [VERIFIED: npm registry] |
| react-i18next | **17.0.7** | React bindings: `useTranslation`, `<Trans>` | Standard pair with i18next. [VERIFIED: npm registry] |

### Supporting / dev

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| unified | **11.0.5** | Markdown AST processor (foundation of remark) | Linter spine: walks mdast nodes to validate UI-SPEC structure. [VERIFIED: npm registry] |
| remark | **15.0.1** | Markdown plugin ecosystem on top of unified | `unified().use(remarkParse).parse(content)` → mdast tree the linter walks. [VERIFIED: npm registry] |
| @types/mdast | latest | TypeScript types for mdast nodes | Linter uses strongly-typed `Root`, `Heading`, `Code`, `Link` nodes. [VERIFIED: unifiedjs.com] |
| @playwright/test | **1.60.0** | E2E framework (used in Phase 8+ when `apps/web/` lands) | Accessibility tests pair with `@axe-core/playwright`. [VERIFIED: npm registry] |
| @axe-core/playwright | **4.11.3** | WCAG 2.2 AA automated accessibility assertions | `AxeBuilder.withTags(['wcag22aa'])` runs WCAG 2.2 AA rules. [VERIFIED: playwright.dev/docs/accessibility-testing] |
| @next/bundle-analyzer | **(track Next.js minor)** | Per-route bundle visualization to enforce ≤200KB gzipped budget | Wrap `next.config.ts` with `withBundleAnalyzer`; run `ANALYZE=true pnpm build`. [VERIFIED: nextjs.org/docs/app/guides/package-bundling] |
| size-limit | latest | Build-fail gate on per-route bundle exceeding budget | Companion to bundle-analyzer; enforces budget in CI rather than visualizing post-hoc. [CITED: codewithseb.com/blog/dynamic-bundle-optimization-under-200kb-guide] |
| vitest | inherited from repo | Linter unit tests with markdown fixtures | Matches existing test framework across `packages/`. [VERIFIED: package.json convention in repo] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| next-i18next | `react-i18next` + manual middleware | next-i18next v16 (2026-02 release) NOW supports App Router; previously was Pages-Router-only. SPEC.md names "i18next + react-i18next" which is the safer manual path. Keep manual setup; `next-i18next` is optional sugar. [VERIFIED: locize.com/blog/next-i18next-v16] |
| next-i18next v16 | next-intl | next-intl is the App-Router-native alternative with simpler setup; rejected because `packages/i18n/` already standardizes on i18next ecosystem (server-side emails / error messages). Symmetry wins. [CITED: next-intl.dev] |
| Recharts | Tremor (Recharts + dashboard layer ~200KB) | Tremor is opinionated dashboards; Phase 7 deliverable is a SPEC, not implementation — keep Recharts as the locked pick and revisit in Phase 8 if U4 bundle exceeds budget. [CITED: pkgpulse 2026] |
| Recharts | Visx (modular, ~30–50KB per chart) | Visx is bring-your-own-axis; gives best bundle but most work. Defer evaluation to Phase 8 once measured. |
| Recharts | Chart.js | Canvas-based; requires `'use client'` + dynamic import for SSR. Recharts (SVG) is SSR-friendly out of the box. [CITED: LogRocket React Chart Libraries 2025] |
| Better Auth client `useSession()` | Custom TanStack Query `useQuery(['session'])` | Better Auth's hook uses nanostore + automatic refetch on sign-out; reinventing risks staleness bugs. Use `useSession()` directly. [CITED: better-auth.com/docs/concepts/client] |
| remark/unified for linter | Hand-rolled regex parsing | Regex chokes on nested headings, code fence inside code fence, link variants. mdast is structured and yields line numbers for diagnostics. **Strongly prefer remark/unified.** |
| @next/bundle-analyzer | Turbopack `--analyze` flag (Next.js 16+) | Phase 7 pins Next.js 15.x; `--analyze` lands with Next.js 16. Stay on `@next/bundle-analyzer` for now. [VERIFIED: nextjs.org/docs/app/guides/package-bundling] |

**Installation (when Phase 8 scaffolds `apps/web/`):**

```bash
# Initialize (CLI handles Tailwind 4 + React 19 if Next.js 15.x is detected)
pnpm dlx shadcn@latest init

# Then per shadcn inventory (D-ART5 appendix):
pnpm dlx shadcn@latest add button input form label card table dialog \
  dropdown-menu badge skeleton toast alert avatar checkbox \
  separator tabs tooltip sheet command popover scroll-area sonner

# Runtime deps
pnpm add @tanstack/react-query @tanstack/react-table better-auth \
  react-hook-form zod @hookform/resolvers recharts date-fns \
  i18next react-i18next

# Dev deps
pnpm add -D @next/bundle-analyzer size-limit @playwright/test \
  @axe-core/playwright unified remark @types/mdast vitest
```

## Architecture Patterns

### Recommended apps/web/ structure (informational only — Phase 7 specs the layout; Phase 8 scaffolds)

```
apps/web/
├── src/
│   ├── app/                          # Next.js App Router root
│   │   ├── layout.tsx                # Root layout: <html>, theme, i18n provider
│   │   ├── page.tsx                  # Marketing/redirect → /app or /sign-in
│   │   ├── (auth)/                   # Route group: shared auth shell
│   │   │   ├── layout.tsx            # AuthShell (split-panel)
│   │   │   ├── sign-in/page.tsx      # U1
│   │   │   ├── sign-up/page.tsx      # U2
│   │   │   └── verify-email/page.tsx # U3
│   │   ├── app/                      # End-user authenticated surface
│   │   │   ├── layout.tsx            # Sidebar + topbar shell; redirect if no session
│   │   │   ├── page.tsx              # U4 Usage dashboard
│   │   │   ├── account/page.tsx      # U5
│   │   │   ├── transcriptions/{page.tsx,[id]/page.tsx}      # U6, U7
│   │   │   ├── notes/{page.tsx,[id]/page.tsx,search/page.tsx} # U8-U10
│   │   │   └── conversations/{page.tsx,[id]/page.tsx,search/page.tsx} # U11-U13
│   │   └── admin/                    # Operator-only surface
│   │       ├── layout.tsx            # Role:admin gate; admin sidebar
│   │       ├── observability/page.tsx  # A2
│   │       └── config/page.tsx       # A3
│   ├── components/
│   │   ├── ui/                       # shadcn primitives (copy-in)
│   │   └── feature/                  # Composite feature components per screen
│   ├── lib/
│   │   ├── auth-client.ts            # better-auth/react client setup
│   │   ├── query-client.ts           # TanStack QueryClient + defaults
│   │   ├── api/                      # Typed fetchers per resource (wire-schemas)
│   │   └── i18n.ts                   # i18next instance + Accept-Language detection
│   ├── locales/{en,ru}/{admin,end-user,common}.json
│   └── middleware.ts                 # Next.js middleware: cookie existence check + redirect
├── components.json                   # shadcn CLI config
├── next.config.ts                    # CSP + HSTS + X-Frame-Options + bundle-analyzer wrap
├── tailwind.config (none in v4)      # Tailwind 4 uses CSS @theme directive in app/globals.css
└── tsconfig.json
```

### Pattern 1: Server Component / Client Component boundary for authenticated routes

**What:** App Router renders Server Components by default. Auth-gated pages use a layout-level `getServerSession` for SSR-friendly redirects, then render Client Components for interactive parts (forms, mutations, charts).

**When to use:** Every page under `/app/*` and `/admin/*`.

**Example pattern:**

```tsx
// app/app/layout.tsx — Server Component, runs on every request
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth-client"; // better-auth server helper
import { AppShell } from "@/components/feature/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return <AppShell user={session.user}>{children}</AppShell>;
}

// app/admin/layout.tsx — additional role gate
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/app");
  return <AdminShell user={session.user}>{children}</AdminShell>;
}
```

**Middleware-level optimization (recommended by Better Auth docs):** In Next.js middleware/edge, check only for the existence of the session cookie (avoid DB round-trip on every request). Full validation runs in the layout. [CITED: better-auth.com/docs/integrations/next]

```ts
// middleware.ts — only checks cookie existence; full validation in layout
import { NextResponse, type NextRequest } from "next/server";
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has("better-auth.session_token");
  const isProtected = req.nextUrl.pathname.startsWith("/app") ||
                      req.nextUrl.pathname.startsWith("/admin");
  if (isProtected && !hasSession) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ["/app/:path*", "/admin/:path*"] };
```

### Pattern 2: TanStack Query 5 query-key convention

**What:** Hierarchical, factory-based query keys allow targeted and broad invalidation without string typos.

**Convention for UI-SPEC** (lock as table in each screen's "Data" subsection):

```ts
// lib/api/keys.ts — single source of truth
export const queryKeys = {
  // Auth
  session: () => ["session"] as const,
  sessions: () => ["sessions"] as const,

  // Usage
  usage: () => ["usage"] as const,
  streamingUsage: () => ["streaming-usage"] as const,

  // Transcriptions
  transcriptions: () => ["transcriptions"] as const,
  transcriptionsList: (filters?: { limit?: number; before?: string; since?: string }) =>
    ["transcriptions", "list", filters ?? {}] as const,
  transcription: (id: string) => ["transcriptions", "detail", id] as const,

  // Notes
  notes: () => ["notes"] as const,
  notesList: (filters?: { folderId?: string; limit?: number; before?: string }) =>
    ["notes", "list", filters ?? {}] as const,
  note: (id: string) => ["notes", "detail", id] as const,
  notesSearch: (q: string) => ["notes", "search", q] as const,

  // Folders
  folders: () => ["folders"] as const,
  foldersList: () => ["folders", "list"] as const,

  // Conversations
  conversations: () => ["conversations"] as const,
  conversationsList: (filters?: { limit?: number; before?: string }) =>
    ["conversations", "list", filters ?? {}] as const,
  conversation: (id: string) => ["conversations", "detail", id] as const,
  conversationMessages: (id: string, page?: { limit?: number; before?: string }) =>
    ["conversations", id, "messages", page ?? {}] as const,
  conversationsSearch: (q: string) => ["conversations", "search", q] as const,

  // Config (admin)
  sttConfig: () => ["stt-config"] as const,
  noteRecordingConfig: () => ["note-recording-config"] as const,
};
```

**Invalidation rule** (lock in UI-SPEC):

- A mutation that affects a resource invalidates the resource's **root** key, which cascades to list + detail + search via prefix matching.
- Example: `DELETE /api/notes/delete` → `queryClient.invalidateQueries({ queryKey: queryKeys.notes() })`.

[CITED: tanstack.com/query/v5/docs/react/guides/query-invalidation, "hierarchical key matching where ['todos'] matches ['todos', 1], ['todos', 2]"]

### Pattern 3: react-hook-form + zod schema-driven forms (U1/U2/U3/U5)

**Pattern:**

```tsx
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signInSchema } from "@openwhispr/wire-schemas"; // imported, NOT redeclared
import { authClient } from "@/lib/auth-client";

type SignInValues = z.infer<typeof signInSchema>;

export function SignInForm() {
  const form = useForm<SignInValues>({ resolver: zodResolver(signInSchema) });
  async function onSubmit(values: SignInValues) {
    await authClient.signIn.email(values);
    // Better Auth handles cookie; redirect after success
  }
  // ... shadcn <Form> + <FormField> wiring
}
```

Errors are announced via `aria-live="polite"` per WCAG 2.2 AA (shadcn `<FormMessage>` does this by default).

### Pattern 4: i18n locale negotiation (App Router)

**Chain:** `Accept-Language` header → cookie override (`NEXT_LOCALE`) → user-preference DB field (Phase 10).

```ts
// lib/i18n.ts — server-side i18next instance per request
import { createInstance } from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import acceptLanguageParser from "accept-language-parser";

const SUPPORTED = ["en", "ru"] as const;
const DEFAULT = "en";

export async function initI18n(acceptLanguage: string | null, cookieLocale: string | null) {
  const parsed = acceptLanguageParser.pick(SUPPORTED, acceptLanguage ?? "") ?? DEFAULT;
  const locale = cookieLocale && SUPPORTED.includes(cookieLocale as never) ? cookieLocale : parsed;
  const i18n = createInstance();
  await i18n
    .use(resourcesToBackend((lng: string, ns: string) =>
      import(`@/locales/${lng}/${ns}.json`)))
    .init({ lng: locale, fallbackLng: DEFAULT, ns: ["common", "admin", "end-user"] });
  return { i18n, locale };
}
```

**Bundles:** `apps/web/src/locales/{en,ru}/{admin,end-user,common}.json` per D-ART4. Russian deferred to Phase 10 (TEST-I18N-01 fires there).

### Anti-Patterns to Avoid

- **❌ Storing tokens in `localStorage`** — sessions live in HttpOnly cookies managed by Better Auth; never expose to JS. (SPEC.md security constraint.)
- **❌ Calling `auth.api.getSession()` on every middleware request** — full DB round-trip per nav; check cookie existence only. [CITED: better-auth.com/docs/integrations/next]
- **❌ Manual `fetch` in components** — always go through TanStack Query (consistent loading/error/cache states).
- **❌ String-literal query keys** — use the `queryKeys` factory (typos break cache invalidation silently).
- **❌ Re-declaring zod schemas** — import from `packages/wire-schemas` (single source of truth with the server).
- **❌ Adding new API endpoints in Phase 7** — D-S1 STEERING RULE. Simplify the screen instead.
- **❌ ASCII wireframes inside fenced ` ```ascii ` blocks** — many parsers don't recognize "ascii" language. Use plain ` ```text ` or ` ``` ` (no lang) for max linter portability.
- **❌ Recharts in Server Component** — wrap in `'use client'` boundary; Recharts uses browser-only APIs.
- **❌ next-i18next v16 with App Router on Next.js 15** — works but creates churn vs. plain react-i18next; SPEC.md names plain react-i18next. Stay there.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session management on the client | Custom cookie reader + refresh logic | `better-auth/react` `useSession()` | Built-in nanostore subscription, automatic refetch on sign-out, handles `set-auth-token` rotation. |
| Server-state caching | `useEffect` + `useState` + `fetch` | TanStack Query 5 `useQuery` / `useMutation` | Stale-while-revalidate, automatic retry, focus-refetch, hierarchical invalidation. |
| Form state + validation | Manual `useState` per field | react-hook-form + zod | Minimal re-renders; schema-driven errors; aria-live built into shadcn `<FormMessage>`. |
| Markdown AST parsing for linter | Regex / line-by-line state machine | `unified` + `remark-parse` + walker | Handles nested headings, code-fence-inside-code-fence, link variants; structured diagnostics with line numbers. |
| Accessibility testing | Manual keyboard sweep | `@axe-core/playwright` + Playwright `toPassAxeAudit` | Catches ≈30% of WCAG issues mechanically; the other 70% needs manual review but axe-core covers most of WCAG 2.2 AA rules. [CITED: deque.com/axe/axe-core] |
| Bundle budget enforcement | "Eyeball it before each release" | `size-limit` configured at 200KB per route + CI gate | Build-fails on regression; visible in PR. |
| Auth role checks in 12 places | Per-page guard | `app/admin/layout.tsx` server-side role check | Single chokepoint; SSR redirect; no flash of unauthorized content. |
| Locale negotiation | `req.headers.get("accept-language").split(",")[0]` | `accept-language-parser` (q-value aware) | Q-value handling is the part everyone gets wrong (`en;q=0.5,ru;q=0.9` should yield `ru`). |
| Designing components from scratch | Bespoke `<Button>` / `<Dialog>` / `<Form>` | shadcn/ui v2 copy-in primitives | Tested in production at thousands of OSS projects; accessibility baked in (Radix UI under the hood); Tailwind 4 themed via CSS variables. |
| Date formatting | `Intl.DateTimeFormat` ad-hoc | `date-fns` with per-function imports | Locale-aware, tree-shakable, used by ru/en formats; consistent across screens. |

**Key insight:** Phase 7's deliverable is a SPEC. The "don't hand-roll" list is the SPEC's reference vocabulary — every screen names these libraries instead of describing custom solutions. Claude Code reading the SPEC then has zero ambiguity about which library implements which concern.

## Runtime State Inventory

Phase 7 ships markdown specifications and a TypeScript linter — no runtime services, no databases touched, no OS-registered jobs altered.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified: this phase writes only `.planning/phases/07-frontend-ui-spec/UI-SPEC-*.md` and `tools/lint-ui-spec.ts`. No DB rows, no Redis keys, no MinIO objects. | None |
| Live service config | None — no n8n, no Datadog, no Tailscale, no Cloudflare. | None |
| OS-registered state | None — no Task Scheduler, no systemd, no pm2. | None |
| Secrets/env vars | None — linter is build-time, no secrets needed. | None |
| Build artifacts | `tools/lint-ui-spec.ts` becomes a CI step. When `apps/web/` scaffolds (Phase 8), `.next/` build cache lands but that's out-of-scope here. | None for Phase 7. |

**Nothing in any category** — Phase 7 is a documentation + tooling phase only.

## Common Pitfalls

### Pitfall 1: Drift between UI-SPEC endpoint references and the live `apps/api/src/routes/` tree

**What goes wrong:** UI-SPEC names `GET /api/usage`. Six months later, a refactor moves it to `GET /api/v1/usage`. UI-SPEC is now wrong but the executor doesn't notice until implementation.

**Why it happens:** Markdown isn't a typed artifact; there's no compiler to catch the rename.

**How to avoid:** The spec linter (D-ART7) greps `apps/api/src/routes/` for every endpoint string the UI-SPEC names. Catches drift on every PR. Concretely:

```ts
// Strategy: extract endpoint references from UI-SPEC mdast (inline-code spans matching /^(GET|POST|PATCH|DELETE) \/api\//),
// then for each one verify a Fastify route file exists. Routes in this repo follow the convention:
//   apps/api/src/routes/<group>/<verb>.ts → exports a build* fn that calls app.<method>('/api/<group>/<verb>', ...)
// The lint loads each .ts file, runs a regex on it for app.get/post/patch/delete + first arg, builds a set,
// then asserts every UI-SPEC-cited endpoint is in the set.
```

**Warning signs:** Linter reports `unknown endpoint: GET /api/foo (no Fastify route file declares this path)`.

### Pitfall 2: Copy-key collisions across two UI-SPEC files

**What goes wrong:** `admin.config.stt.table.header` is defined in BOTH `UI-SPEC-admin.md` and `UI-SPEC-end-user.md`. JSON bundle merge overwrites silently; the wrong English string ships.

**Why it happens:** Two files written by two people (or two passes by the same writer).

**How to avoid:** Linter scans both files, collects every copy-key (regex `[a-z][a-z0-9.-]+\.[a-z0-9.-]+\.[a-z0-9.-]+\.[a-z0-9.-]+\.[a-z0-9.-]+` enforcing 5-level), asserts global uniqueness. Reports duplicates with both line numbers.

### Pitfall 3: Better Auth client/server session shape mismatch

**What goes wrong:** Client `useSession()` returns `{ data: { user, session } }`; server `auth.api.getSession()` returns `{ user, session }` (no `data` wrapper). Code that assumes one shape breaks the other context.

**Why it happens:** Better Auth's discussion #5785 confirms this is intentional and not documented in the basic-usage page. [CITED: github.com/better-auth/better-auth/discussions/5785]

**How to avoid:** UI-SPEC names both shapes explicitly in U5's "Data" subsection. Wrapper types in `lib/auth-client.ts`:

```ts
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient({ baseURL: process.env.NEXT_PUBLIC_API_URL });
export type ClientSession = NonNullable<ReturnType<typeof authClient.useSession>["data"]>;
```

**Warning signs:** Runtime `Cannot read property 'user' of undefined` on a page that worked yesterday after refactoring SSR → CSR.

### Pitfall 4: Tailwind 4 CSS-first config vs. legacy `tailwind.config.js`

**What goes wrong:** Writer references `tailwind.config.js` in UI-SPEC's design-token appendix. Tailwind 4 doesn't use `tailwind.config.js`; tokens live in `app/globals.css` under `@theme { ... }` directive.

**Why it happens:** Training data + tutorials are mostly Tailwind 3.

**How to avoid:** Design-tokens appendix in UI-SPEC names `app/globals.css` `@theme` block, not config.js. Example:

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  --color-background: oklch(0.99 0 0);
  --color-foreground: oklch(0.15 0 0);
  /* ...etc */
}
```

[VERIFIED: ui.shadcn.com/docs/tailwind-v4 — "leave the config path blank" in components.json]

### Pitfall 5: Recharts client/server boundary

**What goes wrong:** U4 dashboard imports `<LineChart>` directly in a Server Component; build fails with `Cannot use 'document' on the server`.

**Why it happens:** Recharts uses ResizeObserver / window APIs internally.

**How to avoid:** UI-SPEC names U4's "Wireframe" section with an explicit `'use client'` boundary annotation. The chart wrapper component is a Client Component; the page Server Component fetches data (via TanStack Query hydration) and renders the client wrapper.

### Pitfall 6: ASCII wireframe trim/whitespace inconsistency

**What goes wrong:** Author drafts wireframe with mixed tabs/spaces; linter complains about "not monospace-uniform"; author reformats by hand each time.

**Why it happens:** Editors handle leading whitespace inconsistently.

**How to avoid:** Linter's wireframe check (D-ART7) is **lenient**: it strips a per-block uniform leading indent (the minimum leading spaces across all lines), then asserts (a) each non-empty line length is within a tolerance band ±2 chars of the longest line OR (b) the block is in a fenced ` ```text ` code block (in which case length variance is tolerated). Provide a `tools/format-wireframe.ts` formatter helper to normalize before commit.

### Pitfall 7: Markdown linter false-positives on screens with omitted optional content

**What goes wrong:** A screen legitimately has no "empty" state (e.g., U7 detail page — if there's no ID, you redirect, not render empty). Linter fires "States section missing 'empty'".

**Why it happens:** Required-section list is rigid.

**How to avoid:** Each of the 4 states (loading/empty/error/success) appears in the States subsection, but a state may be marked `N/A — <reason>`. Linter accepts `N/A` as a valid value but reports it in a separate "non-applicable states" report so a reviewer can sanity-check.

### Pitfall 8: i18n key explosion / unmaintained keys

**What goes wrong:** Writer adds new keys ad-hoc; old keys never get removed; bundles grow to thousands of entries.

**Why it happens:** No mechanical link between "key is named in UI-SPEC" and "key is referenced in code" — for Phase 7 (no code yet) only the first half exists.

**How to avoid:** Phase 10 adds TEST-I18N-01 (en/ru completeness). For Phase 7, the linter asserts: every key named in UI-SPEC follows the 5-level schema; key uniqueness within file scope; appendix i18n-key index is alphabetically sorted (catches obvious drift). When `apps/web/` lands (Phase 8+), add an ESLint rule that fails on literal user-facing strings outside the i18n surface.

## Code Examples

### Spec linter skeleton (D-ART7)

```ts
// tools/lint-ui-spec.ts
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, Heading, Code, InlineCode } from "mdast";

const REQUIRED_SUBSECTIONS = [
  "Purpose", "Roles", "Route", "Data", "Actions",
  "States", "User journey", "Copy keys", "Wireframe", "shadcn primitives",
] as const;

const COPY_KEY_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){4}$/;
const ENDPOINT_RE = /^(GET|POST|PATCH|DELETE|PUT)\s+(\/api\/[a-zA-Z0-9/_-]+)$/;

type Diagnostic = { file: string; line: number; rule: string; message: string };

async function parse(file: string): Promise<{ tree: Root; src: string }> {
  const src = await fs.readFile(file, "utf-8");
  const tree = unified().use(remarkParse).parse(src) as Root;
  return { tree, src };
}

function extractEndpoints(tree: Root): Array<{ method: string; path: string; line: number }> {
  const out: Array<{ method: string; path: string; line: number }> = [];
  // Walk inline code nodes; match ENDPOINT_RE
  // ...mdast-util-visit walk omitted for brevity
  return out;
}

async function listFastifyRoutes(routesDir: string): Promise<Set<string>> {
  // Recursively read .ts files under apps/api/src/routes/, regex for app.{get,post,...}(<path>, ...)
  // Return Set<"METHOD /api/...">
  const found = new Set<string>();
  // ...
  return found;
}

async function lint(specFiles: string[], routesDir: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const allCopyKeys = new Map<string, { file: string; line: number }>(); // for uniqueness
  const liveRoutes = await listFastifyRoutes(routesDir);

  for (const file of specFiles) {
    const { tree } = await parse(file);

    // Check 1: each screen section has all 9 required subsections
    // ...

    // Check 2: every API endpoint referenced exists in routes/
    for (const ep of extractEndpoints(tree)) {
      const key = `${ep.method} ${ep.path}`;
      if (!liveRoutes.has(key)) {
        diagnostics.push({ file, line: ep.line, rule: "endpoint-exists",
          message: `Unknown endpoint ${key} — no Fastify route in apps/api/src/routes/ declares this path.` });
      }
    }

    // Check 3: copy-key uniqueness (cross-file)
    // ...

    // Check 4: See visual: references resolve
    // ...

    // Check 5: wireframe parseability (fenced block of monospace-tolerant lines)
    // ...
  }

  return diagnostics;
}

// CLI entry
const SPECS = [
  ".planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md",
  ".planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md",
];
const ROUTES_DIR = "apps/api/src/routes";

lint(SPECS, ROUTES_DIR).then((diags) => {
  for (const d of diags) console.error(`${d.file}:${d.line} [${d.rule}] ${d.message}`);
  process.exit(diags.length === 0 ? 0 : 1);
});
```

### Per-screen template (one screen, copy-into each UI-SPEC file)

```markdown
## U4 — Usage dashboard

**Purpose.** Authenticated user's at-a-glance view of their accumulated transcription/reason/streaming usage over the trailing 30 days.

**Roles.** authenticated user (any role).

**Route.** `/app` (post-auth landing).

**Data.**

| Datum | Source | Field | Display |
|-------|--------|-------|---------|
| Total transcription minutes (30d) | `GET /api/usage` | `transcribeMinutes` | KPI card |
| Total reason tokens (30d) | `GET /api/usage` | `reasonTokens` | KPI card |
| Total streaming sessions (30d) | `GET /api/streaming-usage` | `sessions[].length` | KPI card |
| Current plan | `GET /api/usage` | `plan` | KPI card (always "unlimited" in v1) |
| Requests/day trend (30d) | `GET /api/usage` | `dailySeries[].{date,requests}` | Line chart (Recharts) |
| Audio-minutes/day (30d) | `GET /api/usage` | `dailySeries[].{date,audioMinutes}` | Bar chart (Recharts) |
| By-provider breakdown | `GET /api/usage` | `providerBreakdown[]` | Horizontal bar / table |

**TanStack Query keys.** `queryKeys.usage()`, `queryKeys.streamingUsage()`.

**Actions.**

| Trigger | Action | Endpoint / Navigation |
|---------|--------|----------------------|
| "Refresh" button | Refetch both queries | `queryClient.invalidateQueries({ queryKey: queryKeys.usage() })` + `streamingUsage()` |
| Click a KPI card | Navigate to detail screen | `/app/transcriptions` (etc.) |

**States.**

- **loading:** 4 `<Skeleton>` KPI cards + 2 chart-shaped skeletons + 1 breakdown skeleton.
- **empty:** "No usage yet — your first transcription will show up here." Single empty state replaces all KPIs.
- **error:** Inline alert (`<Alert variant="destructive">`) with `Retry` button. Charts unmount; KPIs go to `—`.
- **success:** Render charts + KPIs.

**User journey (happy path).**

1. User clicks "Continue with Google" on `/sign-in`.
2. Better Auth OIDC round-trip completes; user is redirected to `/app` (default landing).
3. `app/layout.tsx` verifies session; `app/page.tsx` mounts the dashboard.
4. TanStack Query fires `useQuery({ queryKey: queryKeys.usage() })` and `useQuery({ queryKey: queryKeys.streamingUsage() })` in parallel.
5. While loading, skeletons render; on success (~200ms), KPI numbers fade in, charts animate from zero.
6. User scans numbers, optionally clicks "Transcriptions" KPI to drill into U6.

**Copy keys.**

| Key | English |
|-----|---------|
| `end-user.usage.title` | Usage |
| `end-user.usage.subtitle` | Last 30 days |
| `end-user.usage.kpi.transcribeMinutes.label` | Transcription minutes |
| `end-user.usage.kpi.reasonTokens.label` | Reason tokens |
| `end-user.usage.kpi.streamingSessions.label` | Streaming sessions |
| `end-user.usage.kpi.plan.label` | Plan |
| `end-user.usage.kpi.plan.unlimited.value` | Unlimited |
| `end-user.usage.chart.requestsPerDay.title` | Requests per day |
| `end-user.usage.chart.audioMinutesPerDay.title` | Audio minutes per day |
| `end-user.usage.chart.byProvider.title` | By provider |
| `end-user.usage.action.refresh.label` | Refresh |
| `end-user.usage.empty.title` | No usage yet |
| `end-user.usage.empty.body` | Your first transcription will show up here. |
| `end-user.usage.error.retry.label` | Retry |

**Wireframe.**

```text
+----------------------------------------------------------+
| TopBar: Usage · Last 30 days              [Refresh]      |
+----------------------------------------------------------+
| [KPI: Trx min ] [KPI: Reason tok] [KPI: Streams] [Plan] |
+----------------------------------------------------------+
| Requests per day                                          |
|   ___                                                     |
|  /   \___/\__/\___                                        |
+----------------------------------------------------------+
| Audio minutes per day      | By provider                  |
| ▌▌█▌█▌█▌▌▌                | openai     ████████ 64%      |
|                            | anthropic  ███ 22%           |
|                            | groq       ██ 14%            |
+----------------------------------------------------------+
```

**See visual:** `design/screens-user.jsx#UsageDashboard`.

**shadcn primitives:** `Card`, `Skeleton`, `Button`, `Alert`, `Badge`, `Separator`.
```

### Better Auth React client integration

```ts
// lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "/", // same-origin default
});

// Usage in component:
import { authClient } from "@/lib/auth-client";
function ProfileBar() {
  const { data: session, isPending, refetch } = authClient.useSession();
  if (isPending) return <Skeleton />;
  if (!session) return null;
  return <span>{session.user.email}</span>;
}

// Sessions list (U5) — Better Auth handler already mounted at /api/auth/list-sessions
const { data: sessions } = useQuery({
  queryKey: queryKeys.sessions(),
  queryFn: () => authClient.listSessions(), // wraps GET /api/auth/list-sessions
});

// Revoke session
const revoke = useMutation({
  mutationFn: (token: string) => authClient.revokeSession({ token }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions() }),
});
```

[VERIFIED via codebase: `apps/api/src/routes/better-auth-handler.ts` mounts `app.all("/api/auth/*", ...)` so `list-sessions` / `revoke-session` / `revoke-other-sessions` / `delete-account` / `sign-in/email` / `sign-up/email` are all handled by Better Auth's universal handler. UI-SPEC can reference these by their Better Auth canonical paths without grep-failing — but the linter must know they're handled by the catch-all and not require an explicit Fastify route file per endpoint. See "Linter caveat" below.]

### Linter caveat: Better Auth catch-all routes

The catch-all `app.all("/api/auth/*", ...)` in `better-auth-handler.ts` handles every Better Auth endpoint via dispatch inside the Better Auth library. The linter cannot grep for an explicit `app.get("/api/auth/list-sessions", ...)` line because it doesn't exist. **Mitigation:** the linter has a configurable allowlist of "BA-handled" paths whose existence is guaranteed by the catch-all:

```ts
// tools/lint-ui-spec.config.ts
export const BETTER_AUTH_PATHS = [
  "POST /api/auth/sign-in/email",
  "POST /api/auth/sign-up/email",
  "POST /api/auth/sign-out",
  "POST /api/auth/verify-email",
  "GET /api/auth/get-session",
  "GET /api/auth/list-sessions",
  "POST /api/auth/revoke-session",
  "POST /api/auth/revoke-other-sessions",
  "DELETE /api/auth/delete-account",
  // OIDC social
  "GET /api/auth/sign-in/social/:provider",
  // ... etc
];
```

Anything matching `^/api/auth/` is checked against this allowlist first; if found, route lint passes. Otherwise it falls through to the standard route-file grep.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind 3 + `tailwind.config.js` | Tailwind 4 + `@theme` directive in CSS | Jan 2025 (Tailwind 4) | shadcn/ui v2 (Feb 2025) requires Tailwind 4; `components.json` no longer needs config.js path. [VERIFIED: ui.shadcn.com] |
| `shadcn-ui` npm package | `shadcn` (single name) CLI | Aug 2024 | Use `pnpm dlx shadcn@latest`, not the deprecated `shadcn-ui@latest`. |
| `next-i18next` Pages-Router-only | `next-i18next v16` supports App Router OR plain `react-i18next` with custom middleware | Feb 2026 (v16 release) | SPEC.md names plain react-i18next — stay there, simpler. [CITED: locize.com/blog/next-i18next-v16] |
| Pages Router | App Router (default) | Next.js 13+ | App Router is the only routing model UI-SPEC targets. |
| Manual `useEffect` data fetching | TanStack Query 5 | TanStack Query 4→5 (2023) | Hierarchical key invalidation, mutation-tied refetch. |
| Recharts v2 | Recharts v3 | 2024 | TypeScript-first; smaller surface area. |
| `kubernetes/ingress-nginx` | Traefik 3 (already in this project) | Mar 2026 ingress-nginx EOL | Web app uses session cookies — relevant for SameSite/Domain on cross-subdomain deploys. [CITED: CLAUDE.md hard-do-not-use list] |

**Deprecated/outdated for this phase:**
- `tailwind.config.js` — Tailwind 4 uses CSS `@theme`. UI-SPEC design-tokens appendix MUST reference `app/globals.css`, not `tailwind.config.js`.
- `next/font/google` API change in Next.js 15 — no impact on UI-SPEC since fonts are an implementation detail; just note `Inter` as the typography pick in design tokens.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `GET /api/auth/list-sessions` is available via the Better Auth catch-all in this codebase | Pattern 4 / Code Examples | If the installed Better Auth version doesn't expose `list-sessions` (it's been stable since 1.x but worth confirming via `pnpm --filter=@openwhispr/api list better-auth` and reading `packages/auth/src/...`), U5 sessions list becomes infeasible without a new endpoint — would force D-S1 re-evaluation. Mitigation: planner verifies as Wave 0 task. [ASSUMED] |
| A2 | `GET /api/usage` returns a daily series `dailySeries[].{date,requests,audioMinutes}` for the U4 charts | Code Examples (per-screen template) | If usage endpoint returns only aggregate totals (no day-level breakdown), the line/bar charts have no data and either (a) screen simplifies to KPI-only or (b) Claude Design gets re-engaged. Planner Wave 0 task: read `apps/api/src/routes/usage.ts` and pin the actual response shape; UI-SPEC mirrors it byte-for-byte. [ASSUMED] |
| A3 | The `providerBreakdown[]` field exists in `/api/usage` response | Code Examples | Same as A2. If absent, drop the "By provider" panel from U4 per D-S1 (simplify). [ASSUMED] |
| A4 | The `session.user.role` field is exposed on the Better Auth session in this codebase | Architecture Pattern 1 (admin role gate) | If role is stored separately (e.g., in a `tenant_members` table joined manually), the `/admin/*` layout role-check pattern changes shape. Need to read `packages/auth/` config + any custom session extension. Planner Wave 0 task. [ASSUMED] |
| A5 | `apps/web/` will be scaffolded in Phase 8 (not Phase 7) | Summary, Recommended structure | If planner chooses to scaffold `apps/web/` inside Phase 7, the phase grows from ~5 plans to ~12+, e2e gate fires, and the verifier surface expands materially. Recommend planner explicitly DECIDE this at Wave 0 and document in PLAN-00 (decision: scaffold-now vs scaffold-Phase-8). [ASSUMED — planner's call per CONTEXT note] |
| A6 | Recharts 3.8.1 stays under the 200KB-per-route gzipped budget when only line + bar + small breakdown are imported tree-shaken on U4 | Recharts section | Recharts is ~150KB ungzipped end-to-end; gzipped ~45–60KB typically. Should fit, but unmeasured for this app. Phase 8 measures via `size-limit` and falls back to Visx if breached. [ASSUMED] |
| A7 | `acceptLanguage` cookie is named `NEXT_LOCALE` (de facto convention) and Phase 10's i18n setup will respect it | Pattern 4 i18n | Cookie name is convention, not protocol. Phase 10 should ratify the name in its own spec. [ASSUMED] |
| A8 | Better Auth's `useSession()` returns `{ data, isPending, error, refetch }` shape under React 19 | Code Examples | Verified via docs + GitHub Issue #903 thread; isPending field confirmed. Risk LOW. [CITED: better-auth.com/docs/concepts/session-management; github.com/better-auth/better-auth/issues/903] |

**Planner action items derived from this log:** Wave 0 of Phase 7 (or the plan-check pass) should include a single "verify upstream API shapes" task that reads `apps/api/src/routes/{usage,streaming-usage,stt-config,note-recording-config}.ts` and `packages/auth/` session config, then pins the response shapes in a `## API Reference (verified)` appendix in each UI-SPEC file. This converts every `[ASSUMED]` claim above into a `[VERIFIED: file:line]` claim BEFORE the UI-SPEC body is finalized.

## Open Questions

1. **Should `apps/web/` scaffold happen in Phase 7 or Phase 8?**
   - What we know: SPEC.md says "no `apps/web` yet — Phase 7 produces the SPEC; the Next.js project skeleton itself is created during execute-phase (planner decides)."
   - What's unclear: Whether scaffolding now improves Phase 8 velocity enough to justify expanding Phase 7's scope vs. keeping Phase 7 atomic (markdown + linter only).
   - Recommendation: **Defer to Phase 8.** Phase 7 stays purely a SPEC + linter phase. Justifications: (a) phase-boundary discipline (one phase = one well-shaped artifact set); (b) Phase 8 in roadmap is "Load Test, Tuning & SLO Publication" which is API-tier work — perhaps insert a "Phase 7.5: apps/web scaffold" instead, OR fold scaffolding into the v2 implementation effort. (c) Verifier surface stays small. If planner overrides, the e2e mandate from CLAUDE.md (user-visible route) fires and the phase shape changes materially.

2. **Should the spec linter check that every screen has at least one ASCII wireframe block?**
   - What we know: D-ART2 says "Wireframes = ASCII + JSX reference (Recommended): ✓". The wireframe is required.
   - What's unclear: Whether the linter should enforce wireframe presence OR allow `Wireframe: (see visual: ...)` as an alternative when ASCII is impractical (e.g., complex grid layouts).
   - Recommendation: Linter requires a fenced ` ```text ` block under "## Wireframe" subsection. If a screen's wireframe is genuinely impossible to ASCII-render, mark with a single line `(visual-only — see See visual: line)` inside the fenced block, and the linter accepts that as a sentinel. Document this escape hatch in the linter README.

3. **Does the linter run in pre-commit (lefthook) or only in CI?**
   - What we know: CLAUDE.md mandates GHA-only CI. Lefthook is already used in this repo for commit linting.
   - Recommendation: BOTH — lefthook runs `pnpm lint:ui-spec` on commit (fast local feedback) and GHA runs it on PR (authoritative gate). Skip lefthook on commits that don't touch UI-SPEC or apps/api/src/routes/ to keep it fast.

4. **How does the linter handle the case where a UI-SPEC screen references an endpoint that's still pending (Phase 6 incomplete, etc.)?**
   - What we know: Phase 6 is in flight (`06-VERIFICATION.md` exists); some routes may not yet land.
   - Recommendation: Linter has a `WIP_ENDPOINTS` allowlist that the spec author can populate. Each WIP entry decays after Phase 6 closes — Phase 7 verifier requires WIP list to be empty before flipping the phase to complete.

5. **What's the canonical i18n key namespace split between admin and end-user?**
   - What we know: D-ART4 names `apps/web/src/locales/{en,ru}/{admin,end-user,common}.json`.
   - What's unclear: Whether keys like `common.action.refresh.label` get hoisted to `common.json` automatically, or whether each surface duplicates.
   - Recommendation: Lock in UI-SPEC appendix: any key referenced by BOTH surfaces lives under `common.*` namespace. Linter validates: any key prefixed `common.` must appear in both UI-SPEC files (this surfaces drift); any key prefixed `admin.` or `end-user.` must appear in only the matching file.

## Environment Availability

Phase 7 deliverable is markdown + a Node.js build-time linter. No external services touched at deliverable time. Only build-time tools are needed when the linter actually runs.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 24 LTS | Linter execution (`tsx tools/lint-ui-spec.ts`) | ✓ | per CLAUDE.md | — |
| pnpm | Workspace install | ✓ | per CLAUDE.md | — |
| unified + remark + @types/mdast | Linter dependency (devDependency to add) | ✗ (not installed yet) | latest | — install during Phase 7 |
| vitest | Linter unit tests | ✓ (already used in repo) | per package.json | — |
| GitHub Actions | CI gate | ✓ | per CI-01 | — |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none — install `unified`, `remark`, `@types/mdast`, `mdast-util-from-markdown` in Phase 7 plan.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (matches repo convention; per `packages/*/vitest.config.ts`) |
| Config file | `tools/__tests__/vitest.config.ts` (new — Wave 0) |
| Quick run command | `pnpm vitest run tools/__tests__/lint-ui-spec.test.ts` |
| Full suite command | `pnpm test` (workspace-wide) — Phase 7 adds linter unit tests to the suite |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-SPEC-01 | UI-SPEC-admin.md has all 2 screen sections with all 9 subsections each | Linter unit | `pnpm vitest run tools/__tests__/lint-ui-spec.test.ts -t "admin file structure"` | ❌ Wave 0 |
| UI-SPEC-02 | UI-SPEC-end-user.md has all 13 screen sections with all 9 subsections each | Linter unit | `pnpm vitest run tools/__tests__/lint-ui-spec.test.ts -t "end-user file structure"` | ❌ Wave 0 |
| UI-SPEC-03 | Every API endpoint named in either UI-SPEC file resolves to a Fastify route (or Better Auth catch-all allowlist) | Linter integration | `pnpm vitest run tools/__tests__/lint-ui-spec.endpoint.test.ts` | ❌ Wave 0 |
| UI-SPEC-03 | Every copy key follows 5-level schema and is globally unique | Linter unit | `pnpm vitest run tools/__tests__/lint-ui-spec.test.ts -t "copy keys"` | ❌ Wave 0 |
| UI-SPEC-03 | Every `See visual: design/<file>.jsx#<function>` references a real JSX export | Linter integration | `pnpm vitest run tools/__tests__/lint-ui-spec.visual.test.ts` | ❌ Wave 0 |
| UI-SPEC-03 | ASCII wireframes parse as monospace-tolerant fenced blocks | Linter unit (property-based via fast-check) | `pnpm vitest run tools/__tests__/lint-ui-spec.wireframe.test.ts` | ❌ Wave 0 |
| All | CLI returns non-zero exit on any diagnostic | Linter integration | `node tools/lint-ui-spec.js && echo OK || echo FAIL` (in CI) | ❌ Wave 0 |
| All | GHA workflow runs linter on every PR touching UI-SPEC or routes/ | CI gate | (manual GHA workflow check) | Existing `.github/workflows/ci.yml` — extend |

### Sampling Rate

- **Per task commit:** `pnpm vitest run tools/__tests__/lint-ui-spec*.test.ts` (fast, <5s)
- **Per wave merge:** `pnpm test` + `pnpm lint:ui-spec`
- **Phase gate:** Full suite green + linter passes on both UI-SPEC files + GHA `lint-ui-spec` job present

### Wave 0 Gaps

- [ ] `tools/__tests__/lint-ui-spec.test.ts` — structural checks (9 subsections per screen, presence of headings)
- [ ] `tools/__tests__/lint-ui-spec.endpoint.test.ts` — endpoint existence (greps routes/ + Better Auth allowlist)
- [ ] `tools/__tests__/lint-ui-spec.visual.test.ts` — See-visual reference resolution
- [ ] `tools/__tests__/lint-ui-spec.wireframe.test.ts` — ASCII wireframe parsing
- [ ] `tools/__tests__/fixtures/ui-spec/` — fixture markdown files (valid + invalid samples for each check)
- [ ] `tools/lint-ui-spec.ts` — production linter
- [ ] `tools/lint-ui-spec.config.ts` — `BETTER_AUTH_PATHS` allowlist, `WIP_ENDPOINTS` allowlist
- [ ] Install: `pnpm add -D unified remark @types/mdast mdast-util-from-markdown unist-util-visit`
- [ ] `.github/workflows/ci.yml` — add `lint-ui-spec` job (or extend existing `lint` job)
- [ ] `package.json` workspace root — `"lint:ui-spec": "tsx tools/lint-ui-spec.ts"`

## Security Domain

> Security enforcement is enabled by default in `.planning/config.json` (no explicit `false`).
> Phase 7 deliverable is markdown + a build-time linter — runtime attack surface is zero. The security domain matters for the SPEC's CONTENT, however: the UI-SPEC must encode the security posture that downstream implementation will inherit.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Better Auth (already shipped in Phase 2) — UI-SPEC names sign-in/sign-up flow uses authClient, no custom token handling. |
| V3 Session Management | yes | HttpOnly cookies via Better Auth; never read tokens in JS; `useSession()` reads server state via fetch — UI-SPEC SPEC's Constraints already pin "No tokens or sensitive payloads in localStorage." |
| V4 Access Control | yes | Layout-level role gate (`app/admin/layout.tsx`); middleware-level cookie existence check; UI-SPEC documents this pattern. |
| V5 Input Validation | yes | zod schemas imported from `packages/wire-schemas` — same schemas the server uses. UI-SPEC's Data subsections cite the schemas. |
| V6 Cryptography | no | All crypto stays server-side (Better Auth, key envelope). UI-SPEC documents NO key handling in the browser. |
| V7 Error Handling & Logging | yes | UI-SPEC's error state per screen: surface generic message; do NOT echo server error bodies that may contain stack traces. Better Auth already conforms to global error envelope. |
| V8 Data Protection | yes | UI-SPEC's account deletion (U5): confirmation modal + typed confirmation pattern (user types email to enable Delete). |
| V12 API & Web Service | yes | All UI calls go same-origin to `/api/*`; SameSite=Lax cookie. UI-SPEC must NOT introduce calls to third-party origins from auth pages. |
| V14 Configuration | yes | UI-SPEC's `next.config.ts` snippet documents CSP, HSTS, X-Frame-Options: DENY (already in SPEC.md security constraints). |

### Known Threat Patterns for Next.js 15 + React 19 + Better Auth

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Third-party script on auth screens (token theft) | Information Disclosure / Tampering | SPEC.md constraint: "No third-party scripts on auth screens." UI-SPEC enforces by NOT naming analytics/error-tracking SDKs on `/sign-in`, `/sign-up`, `/verify-email`. |
| Clickjacking | Tampering | `X-Frame-Options: DENY` header (SPEC.md constraint). |
| XSS via dangerouslySetInnerHTML | Tampering | UI-SPEC must NOT recommend `dangerouslySetInnerHTML` for any rendered server data (transcript text, conversation message, note content). All rendering goes through React's default text-escape. Linter SHOULD catch any `dangerouslySetInnerHTML` reference in UI-SPEC body and warn. |
| CSRF on state-changing actions | Tampering | Better Auth ships with `csrfToken` for non-session endpoints; same-origin SameSite=Lax for session-tied actions. UI-SPEC names same-origin assumption. |
| Open redirect in auth callbacks | Tampering | OAuth redirect uses scheme allowlist (Phase 2 D-AUTH-02). UI-SPEC's sign-in screen names "we redirect to `callbackURL` only if scheme matches allowlist." |
| Token leak via window.name / postMessage | Information Disclosure | No tokens ever in JS state per SPEC.md; UI-SPEC explicitly reiterates. |
| CSP bypass via inline scripts | Tampering | Next.js generates nonces; UI-SPEC documents `connect-src`, `script-src 'self' 'nonce-...'`, `style-src 'self' 'unsafe-inline'` (Tailwind 4 injects inline styles), `img-src 'self' data:`. |
| Account enumeration via sign-up error message | Information Disclosure | UI-SPEC sign-up error copy is generic: "Could not create account" — NOT "Email already exists." Backend already does this (Phase 2 D-AUTH-04). |
| Account deletion without re-auth | Tampering | U5 deletion flow: typed-confirmation modal + (optionally) re-prompt for password / OIDC. UI-SPEC's U5 user journey enumerates this. |

## Sources

### Primary (HIGH confidence)

- [Next.js 15 release notes](https://nextjs.org/blog/next-15) — App Router stable, React 19 support
- [Next.js 15 — version 15 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15) — breaking changes
- [shadcn/ui — Tailwind v4 support](https://ui.shadcn.com/docs/tailwind-v4) — CLI behavior, components.json config
- [shadcn/ui — February 2025 changelog](https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4) — Tailwind 4 + React 19 + canary CLI
- [shadcn/ui — components.json reference](https://ui.shadcn.com/docs/components-json) — config schema
- [TanStack Query v5 — Query Invalidation](https://tanstack.com/query/v5/docs/react/guides/query-invalidation) — hierarchical key matching
- [TanStack Query v5 — Invalidations from Mutations](https://tanstack.com/query/v5/docs/react/guides/invalidations-from-mutations) — onSuccess invalidation pattern
- [Better Auth — Next.js integration](https://better-auth.com/docs/integrations/next) — middleware cookie-only check pattern
- [Better Auth — Session Management](https://better-auth.com/docs/concepts/session-management) — useSession hook surface
- [Better Auth — Client](https://better-auth.com/docs/concepts/client) — createAuthClient + nanostore subscription
- [Playwright — Accessibility testing](https://playwright.dev/docs/accessibility-testing) — @axe-core/playwright integration
- [remark / unified ecosystem](https://unifiedjs.com/explore/package/remark/) — markdown AST parser
- [Next.js — Package Bundling guide](https://nextjs.org/docs/app/guides/package-bundling) — bundle analyzer + Turbopack --analyze in v16

### Secondary (MEDIUM confidence — multiple sources cross-verified)

- [pkgpulse — Recharts v3 vs Tremor vs Nivo, 2026](https://www.pkgpulse.com/guides/recharts-v3-vs-tremor-vs-nivo-react-charting-2026) — bundle size comparison
- [pkgpulse — Recharts vs Chart.js vs Nivo vs Visx](https://www.pkgpulse.com/guides/recharts-vs-chartjs-vs-nivo-vs-visx-react-charting-2026) — SSR friendliness
- [LogRocket — React chart libraries 2025](https://blog.logrocket.com/best-react-chart-libraries-2025/) — bundle + DX trade-offs
- [Locize blog — next-i18next v16 App Router](https://www.locize.com/blog/next-i18next-v16/) — App Router support timing
- [Locize blog — i18n with Next.js 13/14/15/16 app dir](https://www.locize.com/blog/next-app-dir-i18n/) — App Router i18n setup guide
- [Deque — axe-core](https://www.deque.com/axe/axe-core/) — WCAG 2.0/2.1/2.2 rule coverage
- [DEV — How We Automate Accessibility Testing with Playwright and Axe](https://dev.to/subito/how-we-automate-accessibility-testing-with-playwright-and-axe-3ok5) — practical CI setup

### Tertiary (LOW confidence — single source, marked for validation)

- [Code with Seb — Dynamic Bundle Optimization under 200KB](https://www.codewithseb.com/blog/dynamic-bundle-optimization-under-200kb-guide) — size-limit config snippet
- [Better Auth GitHub Issue #903](https://github.com/better-auth/better-auth/issues/903) — useSession in Next.js 15 — older issue, behavior should be verified against current 1.6.x
- [Better Auth Discussion #5785](https://github.com/better-auth/better-auth/discussions/5785) — client vs server session shape differences

### Codebase-verified

- `apps/api/src/routes/better-auth-handler.ts` — confirms `app.all("/api/auth/*", ...)` catch-all is in place; Better Auth endpoint surface is delegated.
- `apps/api/src/routes/` — full enumeration of Fastify routes used to back-validate the linter's grep target.
- `.planning/phases/07-frontend-ui-spec/design/ui.jsx` — Claude Design primitives (Icon, Shell, Sidebar, TopBar, AuthShell, BrowserFrame, Badge, Btn, Field, Sk, SkeletonTable, EmptyState, ErrorState). These map to shadcn primitives as: Shell→layout grid; Sidebar→`Sheet`+`ScrollArea`+nav items; TopBar→custom div with `Breadcrumb` + `Button` (icon) + theme `DropdownMenu`; Badge→`Badge`; Btn→`Button`; Field→`Form`+`FormField`+`Input`+`Label`; Sk/SkeletonTable→`Skeleton`; EmptyState/ErrorState→custom div with `Alert` + `Button`.

## Metadata

**Confidence breakdown:**
- Standard stack (versions, picks): **HIGH** — every library version verified via `npm view` on 2026-05-12; primary picks match SPEC.md tech stack constraints byte-for-byte.
- Architecture (RSC/CSR boundary, middleware, query keys): **HIGH** — patterns are canonical and documented; cross-referenced against Next.js and Better Auth official docs.
- UI-SPEC artifact structure: **MEDIUM** — no industry "blessed" example exists for this exact kind of spec; the proposed template is derived from CONTEXT.md's D-ART2..D-ART7 lock plus pragmatic conventions. Risk: the executor may find friction the planner didn't anticipate.
- Spec linter approach (mdast + grep): **HIGH** — `unified`/`remark` is the standard markdown AST tool; route-file grep is mechanically simple.
- WCAG / accessibility tooling: **HIGH** — `@axe-core/playwright` with `withTags(['wcag22aa'])` is the canonical setup, verified against playwright.dev official docs.
- Performance budgets: **MEDIUM** — `@next/bundle-analyzer` + `size-limit` is the accepted pattern, but the actual 200KB-per-route budget hasn't been measured against an empty Next.js 15 + shadcn baseline yet. Phase 8 will surface the truth.
- i18n locale negotiation for App Router: **MEDIUM** — react-i18next + manual middleware works but `next-i18next` v16 just landed App Router support. SPEC.md explicitly names plain react-i18next so stay there.

**Research date:** 2026-05-12

**Valid until:** 2026-06-12 (30 days) for stack versions; **2026-05-26** (14 days) for Next.js 15.x / Better Auth — both are on fast minor cadence; re-verify before execute-phase if execution is more than 2 weeks out.
