# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability, please report it privately:

1. **Do not** open a public GitHub issue.
2. Use [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository ("Security" tab → "Report a vulnerability").
3. Alternatively, email the maintainers (channel to be configured by the operator after fork — see `docs/operations.md`).
4. Include reproduction steps, affected versions, and suggested mitigation if known.

We aim to acknowledge reports within 72 hours and ship a fix or mitigation advisory within 14 days for critical issues.

## Supported versions

| Version | Supported |
|---------|-----------|
| Phase 0 (pre-release) | active development |
| v1 (forthcoming) | will receive security patches |

## Scope

In scope: authentication bypass, multi-tenancy isolation breach, secret leakage, RCE, injection vulnerabilities, supply-chain compromise of CI dependencies.

Out of scope (v1): denial-of-service via resource exhaustion (rate-limit Phase 6), social engineering, physical attacks against operator infrastructure.

## Defenses already wired (Phase 0)

- gitleaks on every PR + weekly schedule
- Trivy filesystem scan on every PR (CRITICAL/HIGH severity gate)
- CodeQL v4 SAST (JavaScript/TypeScript)
- License scan (Apache-2.0-compatible allowlist)
- Dependabot weekly grouped updates with security PR auto-prioritization
- All third-party GitHub Actions pinned to immutable commit SHAs (response to 2026-03-19 Trivy supply-chain incident)
