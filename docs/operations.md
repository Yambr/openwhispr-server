# Operations

> **Phase 0:** This document is a stub. Full deploy / upgrade / scale / backup / restore / troubleshoot content lands in Phase 8 + Phase 10 (DOCS-03).

## Branch protection (post-fork setup)

After forking the repo, an operator with admin access must apply branch protection to `main`:

```bash
export GITHUB_REPOSITORY="<owner>/openwhispr-server"
export GITHUB_TOKEN="<personal-access-token-with-admin:repo-scope>"
bash scripts/setup-branch-protection.sh
```

This applies the configuration in `scripts/branch-protection.json`:

- Required status checks: lint, lint-english, typecheck, test, mutation-quick, pr-checklist, harness-self-check, gitleaks, trivy-fs, codeql, license-scan
- Required PR reviews: 1 approval
- Required linear history
- Force-pushes and deletions blocked
- `enforce_admins: true`

If the workflow job names ever change, update both:

1. `.github/workflows/ci.yml` and `.github/workflows/security.yml` (the actual job keys)
2. `scripts/branch-protection.json` (`required_status_checks.contexts`)

The `branch-protection-contexts` self-test in `tests/self-tests/` verifies the two stay in sync on every PR.

## Vulnerability reporting

See [SECURITY.md](../SECURITY.md). The operator should configure a real reporting channel before publishing the repo.

## Future phases

- **Phase 1:** docker-compose stack (Postgres / PgBouncer / Redis / observability) — `make up` brings real services online
- **Phase 8:** sizing matrix per topology (compose / Helm / GPU pool); published p95 SLOs
- **Phase 9:** Helm chart deploy + upgrade-matrix discipline
- **Phase 10:** full operator handbook (deploy / upgrade / scale / backup / restore / troubleshoot)
