# Phase 32 — Sub-plans Index

| Plan | Title | Atomic commits | Depends on |
| --- | --- | --- | --- |
| 32-01 | Migration `0018_rls_fail_closed.sql` + migration test | 1 RED + 1 GREEN | none |
| 32-02 | 128-case property test on real PG testcontainer | 1 RED + 1 GREEN | 32-01 (migration must exist) |
| 32-03 | `tenant-context.ts` JSDoc contract update + unit tests | 1 RED + 1 GREEN | 32-01 |
| 32-04 | E2E test + docs (security.md "RLS posture") + ROADMAP/REQUIREMENTS prose fix + SUMMARY/COVERAGE | 1 atomic | 32-01..03 |

Hard order: 32-01 → 32-02 → 32-03 → 32-04. Sequential because all four edit shared files (migration journal, schema docs).

Each plan inherits DISCIPLINE Rules 1-14. Strict TDD per Rule 1; ≥90/90/90/90 on diff per Rule 2.
