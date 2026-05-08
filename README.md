# OpenWhispr Server

A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.

> **Status: Phase 0 (Repo Bootstrap & Constitutional CI).** The repo skeleton, CI, and constitutional disciplines are in place. Wire-API endpoints land in Phase 2+.

## Constitutional rules

Every PR enforces:

1. **Strict TDD** — tests precede production code. PR template + advisory commit-order check.
2. **GitHub Actions CI** must be green before any merge to `main`.
3. **English only** for source artifacts (docs, code, comments, identifiers, log keys, commit messages). Mechanically enforced via `tools/lint-english.ts`.
4. **Coverage gate** >= 85% lines / >= 80% branches.
5. **Mutation gate** (Stryker) on auth, multi-tenancy, virtual-key modules.
6. **No plaintext HTTP** on any externally reachable port (Phase 1+).

## Quickstart

```bash
git clone https://github.com/<owner>/openwhispr-server.git
cd openwhispr-server
corepack enable
pnpm install
make dev    # docker compose up -d (placeholder service in Phase 0) + parallel pnpm dev
make test   # full local suite: lint + typecheck + vitest + stryker incremental
```

`make dev` will boot a placeholder Fastify app on `http://localhost:3000/api/health` returning `{"status":"phase-0-placeholder"}`. Real services land starting Phase 1.

## Documentation

- [CONTRIBUTING.md](./CONTRIBUTING.md) — how to set up dev env, TDD discipline, Conventional Commits, English-only rule
- [SECURITY.md](./SECURITY.md) — how to report vulnerabilities
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — Contributor Covenant 2.1
- [docs/operations.md](./docs/operations.md) — operator-facing setup (Phase 0: branch protection; Phase 8/10: full ops)
- [docs/adrs/](./docs/adrs/) — Architecture Decision Records

## License

Apache-2.0. See [LICENSE](./LICENSE).
