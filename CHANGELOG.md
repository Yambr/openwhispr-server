# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [1.2.4] - 2026-06-05

### Fixed

- `/api/agent/stream` now normalizes the forwarded chat messages to exactly one
  system message at index 0, merging an optional `systemPrompt` and any in-array
  system messages into a single deduplicated block while preserving the order of
  all non-system messages. Previously a client that sent both `messages[0]` as a
  system message and a byte-identical `systemPrompt` produced two leading system
  messages, which strict gateway chat templates reject with HTTP 400.

## [1.2.3] - 2026-06-05

### Added

- Web download links on the login and post-login screens.
- `/api/embeddings` and `/api/rerank` operator-gateway passthrough endpoints,
  with `features.embeddings` / `features.rerank` capability flags.
- End-user email header on the diarization gateway branch.

## [1.2.2] - 2026-06-04

### Added

- End-user email forwarding to the operator gateway, configurable via
  `LITELLM_USER_HEADER_NAME`.
- `REALTIME_FORCE_TRANSCRIPTION_MODEL` realtime force-override.

### Changed

- Expanded operator documentation for the gateway and realtime overrides.

## [1.2.1] - 2026-06-04

### Changed

- Reason routing now treats an explicit `requestKind` body field as the primary
  router signal, with a weakened cleanup fallback for older clients that send no
  `requestKind`.

### Fixed

- Cleanup dictation made while an agent is configured now routes to the cleanup
  model with thinking disabled, closing a live cleanup-routing regression.
- Compose now projects `OPENWHISPR_DISABLE_LOCAL_LOGIN` into the API environment.
- Web auth screens are gated on `localLogin.enabled`.

## [1.2.0] - 2026-06-03

### Added

- Server-configurable disable-local-login, surfaced through
  `GET /api/auth/providers` as a `localLogin.enabled` capability field.

### Changed

- Operator-gateway boot guard now accepts a virtual key on the corporate-override
  path.
- `app.tenant_id` rolconfig is bound on a renamed managed application role.
- Desktop sign-in resolves the authorize URL from OIDC discovery.

## [1.1.0] - 2026-06-03

### Changed

- Realigned the chart version, appVersion, and image tag to a single shared
  number so `helm list` and `/api/health` report the same version.

### Fixed

- Fresh `migrate` now succeeds under a single non-bypass role: migrate-pool
  session options set the bypass and tenant context, and the base RLS policies
  are bypass-aware at creation.
- Web SSO now requests the `openid`/`email`/`profile` scopes (plus a just-in-time
  group), so the identity provider returns an id_token and web sign-in completes.

## [1.0.20] - 2026-06-02

### Fixed

- Managed-Postgres deploy compatibility: the worker boots without a separate
  gateway database URL, audit-log partitioning auto-detects its extension with a
  disable switch, and a claim-driven bypass path supports a single non-bypass
  application role.

## [1.0.19] - 2026-06-01

### Fixed

- Diarization requests to the speech backend now send an `Authorization` bearer,
  resolved from an optional override that falls back to the gateway key, fixing
  corporate-gateway 401s.

## [1.0.18] - 2026-05-31

### Added

- Public `/download` page.

### Fixed

- Dead-link and version-badge fixes; the web version badge now reflects the
  shipped tag via a build-time public version argument.

## [1.0.17] - 2026-05-31

### Changed

- Release images are now built on native per-architecture runners instead of a
  single emulated multi-arch build, eliminating the cold-cache arm64 stall while
  keeping both amd64 and arm64 coverage.

## [1.0.16] - 2026-05-30

### Added

- Server build shipping OIDC SSO just-in-time provisioning with a live identity
  provider end-to-end test.

## [1.0.15] - 2026-05-28

### Fixed

- Streaming now emits content chunks before surfacing an error.

## [1.0.14] - 2026-05-28

### Changed

- Pre-push test-evidence gate validates the tip commit only, keeping it
  compatible with the test-driven workflow.

[Unreleased]: https://github.com/Yambr/openwhispr-server/compare/v1.2.4...HEAD
[1.2.4]: https://github.com/Yambr/openwhispr-server/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/Yambr/openwhispr-server/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/Yambr/openwhispr-server/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/Yambr/openwhispr-server/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Yambr/openwhispr-server/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Yambr/openwhispr-server/compare/v1.0.20...v1.1.0
[1.0.20]: https://github.com/Yambr/openwhispr-server/compare/v1.0.19...v1.0.20
[1.0.19]: https://github.com/Yambr/openwhispr-server/compare/v1.0.18...v1.0.19
[1.0.18]: https://github.com/Yambr/openwhispr-server/compare/v1.0.17...v1.0.18
[1.0.17]: https://github.com/Yambr/openwhispr-server/compare/v1.0.16...v1.0.17
[1.0.16]: https://github.com/Yambr/openwhispr-server/compare/v1.0.15...v1.0.16
[1.0.15]: https://github.com/Yambr/openwhispr-server/compare/v1.0.14...v1.0.15
[1.0.14]: https://github.com/Yambr/openwhispr-server/releases/tag/v1.0.14
