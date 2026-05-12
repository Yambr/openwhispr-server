# Phase 7: Frontend UI-SPEC - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 07-frontend-ui-spec
**Areas discussed:** API divergences in design, Missing UX bits, UI-SPEC artifact structure, U4 activity feed

---

## Steering rule (user-volunteered)

User added a guiding rule alongside multi-select gray-area picks:

> "Толкаемся от спеки бэка, фронт или упрощаем или если неясно пнем повторно claude design"

Locked as **D-S1** in CONTEXT.md. Drives every subsequent decision below.

---

## Area 1 — API divergences in design

### U7 transcription detail (word-timestamps)

| Option | Description | Selected |
|--------|-------------|----------|
| Simplify frontend (Recommended) | Flat transcript, no timecodes, word_count in metadata | ✓ |
| Push back — check real shape | Inspect raw_text for Whisper word data | |
| Defer to Phase 7.x | Word-level timestamps as separate feature | |

**Notes:** Aligns with steering rule.

### U5 sessions list

| Option | Description | Selected |
|--------|-------------|----------|
| Better Auth endpoints in SPEC (Recommended) | Use list-sessions / revoke-session under /api/auth/* | ✓ |
| Simplify: current session only + global sign-out | Drop session list | |
| Defer to Phase 7.x | v1 shows profile + delete only | |

**Notes:** Better Auth handler already mounted; not a new API.

### A1 audit Export CSV

| Option | Description | Selected |
|--------|-------------|----------|
| Client-side Blob from current page (Recommended) | No new API | |
| New /api/admin/audit/list + export | Scope creep — RLS, pagination, scopes | |
| Drop in v1 | Operators use psql / Grafana | ✓ |

**Notes:** Mooted by A1 itself being dropped (below).

### A3 effective env block

| Option | Description | Selected |
|--------|-------------|----------|
| Drop block in v1 (Recommended) | Security hot zone; docs link suffices | ✓ |
| Keep with redacted-only | New /api/admin/env-summary endpoint | |
| Re-engage Claude Design | Update mockup | |

**Notes:** Security stance — no env-var surfacing.

### A1 audit page itself (raised as critical follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Add endpoint in Phase 7 | Phase 6 D-A5 allows this | |
| Drop A1 from v1, move to 7b | Admin v1 = A2 + A3 only | ✓ |
| Read-only Grafana embed | iframe with audit_log datasource | |

**Notes:** Honors steering rule strictly — no new endpoint added in Phase 7.

### U4 Latest activity feed

| Option | Description | Selected |
|--------|-------------|----------|
| Client-side merge from 3 endpoints (Recommended) | useQuery parallel + sort/limit on client | |
| New /api/activity/recent | Scope creep | |
| Drop block from v1 | KPI + charts only | ✓ |

**Notes:** Steering rule won out over client-side workaround.

---

## Area 2 — Missing UX bits

### Password reset flow

| Option | Description | Selected |
|--------|-------------|----------|
| Add U14+U15 in v1, re-engage Claude Design (Recommended) | Production-grade OSS auth | |
| Magic-link only (remove passwords) | Would re-spec | |
| Defer to Phase 7.x | v1 without reset | ✓ |

**User's free-text:** "Бля я вообще хотел чисто через ldap или oidc другие впускать нахуй нам email вообще, так что отложи в бэклог подальше. И разве betterauth ldap не поддерживает?"

**Follow-up Q on email/password scope:**

| Option | Description | Selected |
|--------|-------------|----------|
| OIDC only — drop email/password from v1 (Recommended) | 13 → 10 screens | |
| OIDC + email (original SPEC) | Keep email + add reset screens | ✓ |
| OIDC + email in CLI installer only | Bootstrap admin via env, web OIDC only | |

**User's free-text on follow-up:** "Не выкидываем, доделывай просто пока без reset положи его в бэклог."

**Resolution:** D-UX1 keeps email/password sign-up/sign-in/verify-email in v1 UI as SPEC originally stated. D-UX2 moves password reset to 7.x. Forgot-password link in U1 disabled in v1.

**Better Auth LDAP question (assistant answered):** Better Auth core 1.x does not have a native LDAP plugin. LDAP/AD support is delivered via OIDC bridge (Keycloak / Authentik / Okta), already documented in CLAUDE.md as the corp pattern. Locked as **D-UX4** — "Continue with SSO" generic label, corp operators wire LDAP via OIDC env vars.

### PAK manager UI

| Option | Description | Selected |
|--------|-------------|----------|
| Add U16 PAK manager (Recommended) | Read-only list + revoke | |
| Not needed — desktop has it | Risk if user lost desktop access | |
| Defer to 7.x | In backlog | ✓ |

**User's free-text:** "Назуя нам personal access key?"

**Assistant clarified:** PAK is desktop's auth mechanism via dual-auth.ts. Removing it breaks desktop. User then selected "Оставить PAK в бэке, без UI" — D-UX3.

### Folders CRUD

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only (Recommended) | Desktop owns writes | ✓ |
| Add CRUD in v1 | Would break "desktop owns writes" | |

**Notes:** Honors SPEC D-SPEC-4.

---

## Area 3 — UI-SPEC artifact structure

### Wireframe format

| Option | Description | Selected |
|--------|-------------|----------|
| ASCII + JSX reference (Recommended) | Block-level ASCII + See visual: line | ✓ |
| ASCII only | JSX as bonus reference | |
| JSX reference only | Skip ASCII, violates SPEC AC | |

### Design asset location

| Option | Description | Selected |
|--------|-------------|----------|
| .planning/phases/07-frontend-ui-spec/design/ (Recommended) | Co-located with SPEC | ✓ |
| apps/web/design-reference/ | Inside future Next.js project | |
| docs/design/phase-07/ | Generic docs path | |

**User's free-text:** "Перенести из архива в раздел который предложил в первом пункте чтобы не валялось где попало zip и jsx"

**Resolution:** Archive `Open wispr server.zip` extracted to `.planning/phases/07-frontend-ui-spec/design/`, archive deleted, all JSX/HTML/JS files vendored in-repo.

### Copy-keys schema

| Option | Description | Selected |
|--------|-------------|----------|
| `{surface}.{screen}.{section}.{element}.{prop}` (Recommended) | 5-level dotted hierarchy | ✓ |
| Flat keys | Plain underscored | |
| Component-scoped TanStack i18n | Per-component bundles | |

### shadcn inventory location

| Option | Description | Selected |
|--------|-------------|----------|
| Both per-screen + appendix (Recommended) | Inline list + global add-commands | ✓ |
| Appendix only | Shorter SPEC | |
| Per-screen only | No global setup | |

---

## Claude's Discretion

- Exact shadcn variant tokens (`Button kind="ghost"` vs `variant="outline"`) — picker chooses based on shadcn v2 canonical naming.
- Exact English string text within each copy key.
- Order of screen sections within each UI-SPEC file (alphabetical-by-route default).

---

## Deferred Ideas

- **Phase 7.x:** U14/U15 password reset, U16 PAK manager web UI, A1 audit log viewer + backing `/api/admin/audit/list` endpoint.
- **Phase 7b:** Tenants/Users CRUD, IdP/LiteLLM config UIs (would also need admin-cross-tenant API).
- **Phase 6.x (carry-over):** API-tier Fastify pino logger wiring; virtual-key-rotation dead-code cleanup.
- **Re-engage Claude Design (post-CONTEXT, before execute):** U1 "Forgot password" disabled state, A3 vertical balance after removing Effective env, U4 grid balance after removing activity feed.
