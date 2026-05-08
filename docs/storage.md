# Storage Conventions

OpenWhispr Server uses a single MinIO bucket with per-tenant key prefixes for
all object storage. This document captures the v1 convention agreed by phase
1 decisions D-27 and D-28.

## Bucket Layout

| Field           | Value                                                |
| --------------- | ---------------------------------------------------- |
| Bucket          | `openwhispr`                                         |
| Region          | `us-east-1` (MinIO default; ignored for self-host)   |
| Versioning      | Off in v1 (Phase 9 turns on with lifecycle rules)    |
| Object lock     | Off in v1                                            |
| Server-side enc | MinIO SSE-S3 default (per-tenant KMS in Phase 6+)    |

A single bucket avoids per-tenant bucket-creation latency and the AWS S3
limit of 100 buckets per account (irrelevant for MinIO, but the API layer
is also expected to talk to AWS S3 in cloud deployments — keeping the
bucket count to one keeps the operational story uniform).

## Key Prefix Convention

Every object key follows the shape:

```
tenants/<tenant-uuid>/<resource-type>/<resource-id>[<extension>]
```

Worked examples:

```
tenants/00000000-0000-0000-0000-000000000000/audio-uploads/9b1c4f6a-... .wav
tenants/00000000-0000-0000-0000-000000000000/exports/2026-05-09T10-00-00Z.zip
tenants/11111111-1111-1111-1111-111111111111/audio-uploads/de4a... .opus
```

`<tenant-uuid>` is the UUID stored in the `tenants.id` column. The
default tenant (seeded by the first migration) is the all-zeroes UUID
`00000000-0000-0000-0000-000000000000`.

`<resource-type>` is one of:

| Resource type    | Producer                          | Lifecycle (Phase 9)     |
| ---------------- | --------------------------------- | ----------------------- |
| `audio-uploads`  | `/api/audio/transcriptions`       | Delete after 30 days    |
| `audio-realtime` | `/v1/realtime` saved sessions     | Delete after 7 days     |
| `exports`        | Operator data exports             | Delete after 365 days   |
| `attachments`    | User-attached files (Phase 4+)    | Tenant-quota driven     |
| `model-cache`    | Bundled model artifacts (Phase 3) | Versioned by model hash |

The full resource-type list is owned by `apps/api` and is enforced by the
storage adapter at the SDK boundary.

## Tenancy Enforcement

v1 relies on **app-tier prefix discipline** — no MinIO IAM policies. Every
write goes through a thin storage helper whose first argument is a
tenant-scoped `withTenant`-bound context, so a missing tenant is a
compile-time mistake. Reads are similarly tenant-bound.

Phase 6+ adds MinIO access policies that pin each tenant's API role to
its own prefix, providing defense in depth. The single-bucket convention
is forward-compatible — bucket policies can be expressed against
`s3:prefix=tenants/<tenant-uuid>/*` without any data migration.

## Multipart Uploads (RESEARCH-INFRA §8.3)

Operators uploading large audio files via the API must respect the AWS
SDK v3 multipart limits:

| Parameter   | Value      | Note                                 |
| ----------- | ---------- | ------------------------------------ |
| Min part    | 5 MiB      | S3 spec (last part may be smaller)   |
| Max part    | 5 GiB      | S3 spec                              |
| Default     | 16 MiB     | AWS SDK v3 `partSize`                |
| Queue size  | 4          | AWS SDK v3 `queueSize` parallelism   |
| Max object  | 5 TiB      | S3 spec                              |

These defaults are tuned for a 1-Gbps single-host self-host. The compose
profile pins MinIO with no upload-size override; operators on slower
links may lower `partSize` to 8 MiB to reduce per-part retransmit cost.

## Console Access

The MinIO console is reachable at `http://minio-console.localhost` via the
Traefik dynamic route shipped with `compose/traefik/dynamic.yml`. Login
with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` from `.env`. Phase 9 puts
this route behind cert-manager + admin-IP allowlist for production.

## Cross-References

- Backup and restore for the Postgres tier: see [operations.md](operations.md)
- Threat model entry covering object-storage tenancy: phase 1 plan 06,
  threats T-PHASE6-* (deferred — placeholder until Phase 6 plan lands).
