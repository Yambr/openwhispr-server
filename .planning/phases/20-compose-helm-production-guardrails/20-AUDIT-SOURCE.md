# Ревью compose + Helm: best practices, probes, связность

## Context

Запрошен read-only аудит всех `docker-compose*.yml` и Helm-чартов в `/Users/dev/openwhispr-server` на предмет:
- best practices (resource limits, restart, security hardening, logging)
- наличия и корректности probes (liveness/readiness/startup)
- консистентности связей между сервисами без дыр и костылей
- паритета между compose и Helm как двумя deployment-поверхностями

Покрытие: 13 compose-файлов (`docker-compose.yml` + `compose/*.yml` + `compose/e2e/*.yml` + `compose/live-soak/*.yml`) и Helm-чарт `charts/openwhispr/` (Chart 1.0.0 / app 0.9.0-rc1) с 46 шаблонами и CNPG-кластером.

Это аудит — план не предполагает изменений. Финальный раздел — actionable roadmap для следующих фаз.

---

## Общая оценка

| Surface | Production-readiness | Архитектура | Ops-guardrails |
|---|---|---|---|
| **docker-compose** | ~70% | ✅ Отличная (profile composition, dependency ordering, image pinning, нет секретов в коде) | ❌ Слабая (нет limits, нет capability drop, нет log rotation) |
| **Helm chart** | ~75% | ✅ Отличная (CNPG Cluster CR, schema.json валидация, чёткие helpers, fail gates) | 🟡 Частичная (resources есть, security context есть только у OTel, нет anti-affinity, нет NetworkPolicy templates) |
| **Cross-surface парити** | ✅ Хороший | env-vars, service DNS, lifecycle hooks почти синхронны | 🟡 5 средних дыр (см. блок C) |

Костылей не найдено. Нет `:latest` тегов, нет plaintext HTTP наружу, нет hardcoded секретов, нет дублей сервисов, нет dead-кода.

---

## A. Docker-compose findings (топ-10 по severity)

| # | Severity | Issue | Files |
|---|---|---|---|
| A1 | **BLOCKER** | Нет `deploy.resources.limits` ни на одном сервисе — postgres/litellm/api/worker могут OOM-нуть ноду | `docker-compose.yml`, все overlay |
| A2 | **BLOCKER** | Traefik без `restart: unless-stopped` — крэш Traefik = полный outage ingress | `compose/docker-compose.ingress.yml:30-88` |
| A3 | **HIGH** | Нет POSIX hardening (`cap_drop: [ALL]`, `security_opt: no-new-privileges`, `read_only`) | все файлы |
| A4 | **HIGH** | Нет `logging.driver: json-file` с `max-size`/`max-file` — логи могут забить `/var/lib/docker` | все файлы |
| A5 | **HIGH** | PgBouncer без `restart` — смерть процесса = бесконечный hang api на `service_healthy` | `compose/docker-compose.pgbouncer.yml` |
| A6 | **HIGH** | MinIO без `restart` — то же поведение | `compose/docker-compose.storage.yml` |
| A7 | **HIGH** | LGTM сервисы (otel-collector, loki, tempo, mimir, grafana) без `restart` — телеметрия молча уходит в чёрную дыру | `compose/docker-compose.observability.yml` |
| A8 | MEDIUM | Worker без healthcheck — смерть процесса детектится только когда BullMQ-loop встаёт | `docker-compose.yml:327-367` |
| A9 | MEDIUM | Конфиг-маунты (traefik dynamic.yml, litellm config) не `:ro` везде; docker socket mounted `:ro` уже корректно | `compose/docker-compose.ingress.yml` |
| A10 | MEDIUM | В базе `api/traefik/web` нет `ulimits.nofile` — connection exhaustion под умеренной нагрузкой (load-test overlay их добавляет, но прод-overlay базируется на ingress без них) | `docker-compose.yml:200-438` |

Что сделано хорошо:
- ✅ `depends_on: condition: service_healthy` везде где нужно (migrate → api → web, worker → valkey, litellm → postgres, etc.)
- ✅ Все image-теги pinned (`litellm:main-v1.83.14-stable`, `postgres:17.5-pgpartman`, `valkey:8.1-alpine`, `minio:RELEASE.2025-...`)
- ✅ Named volumes для всего stateful (postgres_data, valkey_data, minio_data, letsencrypt, loki_data, tempo_data, mimir_data, grafana_data)
- ✅ HTTP→HTTPS redirect 308 в `traefik.yml:40-46`
- ✅ Профили (`default`, `obs-only`, `db-only`, `load-test-mock`, `load-test-realistic`, `contract-test`, `e2e`) разделяют слои чисто
- ✅ Distroless образы (otel-collector, mimir, tempo) корректно даунгрейдят `service_healthy → service_started` с явным комментарием
- ✅ ACME overlay использует `${LETSENCRYPT_EMAIL:?…}` fail-fast pattern
- ✅ Live-soak overlay явно изолирован, не импортируется в default flow, имеет cost-discipline guard

---

## B. Helm chart findings (топ-10 по severity)

| # | Severity | Issue | Files |
|---|---|---|---|
| B1 | **HIGH** | Нет `startupProbe` на медленно-стартующих сервисах (api, web, worker, litellm) — readiness может фейлиться во время bootstrap и pod уходит в CrashLoopBackOff | `api-deployment.yaml:173`, `web-deployment.yaml:103`, `worker-deployment.yaml:105`, `litellm-deployment.yaml:97` |
| B2 | **HIGH** | Нет `podAntiAffinity` / `topologySpreadConstraints` ни на одном Deployment — реплики могут лечь на одну ноду, нода падает = полный outage. Несовместимо с заявленной целью «1000 concurrent HA» | все Deployments + OTel DaemonSet |
| B3 | **HIGH** | На api/web/worker/litellm нет `securityContext` (ни pod-, ни container-уровня) — pods запускаются как root, нет `runAsNonRoot`, `readOnlyRootFilesystem`, `capabilities.drop: [ALL]`, `allowPrivilegeEscalation: false`, `seccompProfile: RuntimeDefault`. OTel Collector хардненнут только частично (`runAsUser: 0` намеренно для hostmetrics, drop ALL, readOnlyRootFS — но `allowPrivilegeEscalation` и `seccompProfile` отсутствуют) | `api-deployment.yaml`, `web-deployment.yaml`, `worker-deployment.yaml`, `litellm-deployment.yaml`, `otel-collector-daemonset.yaml:81-86` |
| B4 | MEDIUM | Нет `checksum/config` аннотаций на api/web/worker Deployments — изменения в ConfigMap не вызовут rollout. На LiteLLM и OTel Collector аннотации есть и работают | `api-deployment.yaml`, `web-deployment.yaml`, `worker-deployment.yaml` |
| B5 | MEDIUM | `networkPolicy.enabled` существует в values, но **нет ни одного NetworkPolicy template** — фича задекларирована, не реализована. Кластер default-allow | `values.yaml:424-425`, отсутствуют `templates/networkpolicy-*.yaml` |
| B6 | MEDIUM | Нет HPA на web и litellm | `values.yaml:272-277`, отсутствует `web-hpa.yaml`, `litellm-hpa.yaml` |
| B7 | MEDIUM | Нет PDB на web и litellm (на api/worker PDB условные, по `minReplicas >= 2` — корректно) | отсутствуют `web-pdb.yaml`, `litellm-pdb.yaml` |
| B8 | MEDIUM | `automountServiceAccountToken` не выставлен в `false` явно ни на одном pod-spec — api/web/worker/litellm монтируют K8s токен бессмысленно | `serviceaccount.yaml`, все Deployments |
| B9 | LOW | `postgres.storageClass` не enforced в `values.schema.json` — production deploys могут получить дефолтный StorageClass оператора без проверки | `values.schema.json`, `postgres-cluster.yaml:125-129` |
| B10 | LOW | `worker.autoscaling.queueDepthMetric` (KEDA/prometheus-adapter на `bullmq_queue_waiting_total`) выключен по умолчанию, и зависимость от prometheus-adapter упомянута только в коде HPA, не в NOTES.txt | `worker-hpa.yaml`, `NOTES.txt` |

Что сделано хорошо:
- ✅ CNPG `Cluster` CR (не голый StatefulSet), PG17 enforced через `values.schema.json` паттерн `^.+:17\.[0-9]+.*$` (защита от silent drift на CNPG default catalog PG18)
- ✅ `postInitSQL` + `postInitApplicationSQL` + `managed.roles` (BYPASSRLS owner / NOBYPASSRLS app user)
- ✅ CNPG Pooler CR с `poolMode: transaction`, `max_client_conn: 1000` (parity с compose)
- ✅ Migrate Job c `backoffLimit: 0`, `restartPolicy: Never`, `ttlSecondsAfterFinished: 3600`, wait-for-migrate initContainer на api/worker
- ✅ Resources (requests + limits) на всех Deployments и Job
- ✅ HPA `autoscaling/v2` на api + worker; worker имеет опциональный external metric на queue depth
- ✅ Traefik IngressRoutes раздельные: `:443` для short JSON + `:8443` для long WSS с `ServersTransport idleConnTimeout: 3600s` (соответствует BACKEND_SPEC realtime)
- ✅ `helm lint` — 0 failures
- ✅ `values.schema.json` с conditional if/then, minLength на secrets, enum валидацией, kubeVersion `>=1.28.0-0`, Chart.lock закоммичен
- ✅ Secrets с `helm.sh/resource-policy: keep` — не теряются на uninstall (защита Better Auth sessions)
- ✅ Двойной режим секретов: inline Secret + ExternalSecret (ESO) — оба пути с fail gates

---

## C. Cross-surface (compose ↔ Helm) парити-дыры

| # | Severity | Issue | Где |
|---|---|---|---|
| C1 | MEDIUM | Нет `docker compose config` линта в CI — compose-syntax/interpolation баги ловятся только в e2e (`helm-lint.yml` есть, compose-аналога нет) | `.github/workflows/ci.yml` |
| C2 | MEDIUM | `POSTGRES_APP_PASSWORD` не имеет жёсткого fail gate в Helm secrets — на ESO-режиме отсутствующий ключ приводит к runtime auth-error вместо install-time fail | `charts/openwhispr/templates/secrets.yaml`, `values.schema.json` |
| C3 | MEDIUM | `LITELLM_CONFIG_FILE` в compose динамически переключается (`litellm_config.yaml` / `litellm_config.contract.yaml` / `litellm_config.realistic.yaml`); Helm запекает конфиг в ConfigMap из `values.litellm.config` без примеров overlay для contract-test / load-test | `docker-compose.yml:170-172`, `charts/openwhispr/templates/configmap-litellm.yaml`, `charts/openwhispr/examples/` |
| C4 | MEDIUM | `minioRootPassword` не имеет `minLength` в schema, но требуется когда `storage.enabled=true` — silent install с пустым паролем возможен | `values.schema.json:128-132` |
| C5 | LOW | `tools/lint-compose-chart-parity.ts` существует и гейтится в `helm-lint.yml:115`, но покрытие не документировано — нужно проверить, что валидирует все env-vars из кода api/worker/web в обеих поверхностях | `.github/workflows/helm-lint.yml:115-119`, `tools/lint-compose-chart-parity.ts` |
| C6 | LOW | Service-name asymmetry: compose `valkey` (короткое имя в bridge DNS) vs Helm `<release>-valkey-primary` (Bitnami sub-chart). Helpers абстрагируют это корректно, но любой жёстко прописанный `redis://valkey:…` сломается в Helm | `compose/docker-compose.yml:84-97`, `charts/openwhispr/templates/_helpers.tpl` |
| C7 | LOW | SMTP env-vars (`SMTP_HOST/PORT/USER/PASSWORD/FROM`) задокументированы в `.env.full.example`, читаются api в коде, но Helm chart не имеет ни ConfigMap, ни примера overlay для них — операторы получают тихий «email disabled» без подсказки | `.env.full.example:152-156`, `charts/openwhispr/templates/api-deployment.yaml` |
| C8 | LOW | OTel disable semantics расходится: compose оставляет `OTEL_EXPORTER_OTLP_ENDPOINT` пустым, Helm выставляет `OTEL_SDK_DISABLED=true`. Оба работают, но семантика разная — стоит унифицировать | `docker-compose.yml:282`, `charts/openwhispr/templates/api-deployment.yaml:139-140` |
| C9 | LOW | Helm `examples/` не содержит `values-contract-test.yaml` / `values-load-test.yaml` — оператор не имеет рабочего шаблона для воспроизведения compose-режимов в K8s | `charts/openwhispr/examples/` |
| C10 | LOW | Нет `docs/SELF_HOSTING.md` для compose; Helm chart имеет полноценный `README.md` с prerequisites, операторам compose эквивалента нет | проект-level docs |

Что синхронно и корректно:
- ✅ Migration lifecycle: compose `migrate: restart: "no"` + `service_completed_successfully` ↔ Helm `Job backoffLimit:0` + `wait-for-migrate initContainer` — паритет точный
- ✅ Pooler: compose PgBouncer `POOL_MODE: transaction` ↔ Helm CNPG Pooler `poolMode: transaction` — паритет
- ✅ Constitution: pinned images везде, HTTPS-only наружу (compose Traefik dynamic.yml + Helm IngressRoute `entryPoints: [websecure]`), English identifiers — паритет
- ✅ Realtime WSS: compose `:8443` entrypoint с `transport.lifecycle.idleTimeout 3600s` ↔ Helm `:8443 entrypoint` + `ServersTransport idleConnTimeout: 3600s` — паритет точный
- ✅ Direct-vs-pooler routing: migrate и litellm идут direct в Postgres (DDL/Prisma), api/worker/web идут через pooler — паритет в обеих поверхностях

---

## D. Critical files для следующих fix-фаз

Compose:
- `docker-compose.yml` — добавить `deploy.resources.limits`, `logging`, `cap_drop`, `security_opt`, `read_only` базово
- `compose/docker-compose.ingress.yml` — `restart: unless-stopped` на traefik
- `compose/docker-compose.pgbouncer.yml` — `restart: unless-stopped`
- `compose/docker-compose.storage.yml` — `restart: unless-stopped`
- `compose/docker-compose.observability.yml` — `restart: unless-stopped` × 5

Helm:
- `charts/openwhispr/templates/api-deployment.yaml`, `web-deployment.yaml`, `worker-deployment.yaml`, `litellm-deployment.yaml` — добавить `startupProbe`, `securityContext` (pod + container), `topologySpreadConstraints`, `checksum/config` аннотацию, `automountServiceAccountToken: false`
- `charts/openwhispr/templates/` — новые: `networkpolicy-*.yaml`, `web-hpa.yaml`, `web-pdb.yaml`, `litellm-hpa.yaml`, `litellm-pdb.yaml`
- `charts/openwhispr/values.schema.json` — добавить fail gates на `postgresAppPassword`, `minioRootPassword`, требование `postgres.storageClass`

CI/parity:
- `.github/workflows/ci.yml` — новый job `compose-lint` с `docker compose config` на всех профилях
- `tools/lint-compose-chart-parity.ts` — документировать покрытие, добавить env-var diff между `.env.full.example` ↔ `values.yaml` ↔ `apps/api/src/**/*.ts`

---

## E. Recommended phasing

**P0 — Production-blocker remediation** (blocking 1000-user HA target):
1. Compose: `deploy.resources.limits` на всех сервисах + `restart: unless-stopped` на traefik/pgbouncer/minio/LGTM
2. Helm: `startupProbe` на api/web/worker/litellm; `topologySpreadConstraints`; `securityContext` (runAsNonRoot, readOnlyRootFS, capabilities drop)
3. CI: `docker compose config` lint job

**P1 — Security hardening**:
4. Compose: `cap_drop`, `security_opt: no-new-privileges`, `logging` driver
5. Helm: NetworkPolicy templates (default-deny + explicit allow); `automountServiceAccountToken: false`; OTel Collector `allowPrivilegeEscalation: false` + `seccompProfile`
6. Helm: `POSTGRES_APP_PASSWORD` + `MINIO_ROOT_PASSWORD` schema fail gates

**P2 — Operational polish**:
7. Helm: HPA + PDB для web и litellm
8. Helm: `checksum/config` аннотации на api/web/worker
9. Helm: примеры `values-contract-test.yaml`, `values-load-test.yaml`
10. Docs: `docs/SELF_HOSTING.md` с разделами для compose + Helm

---

## Verification

Так как этот план — read-only аудит, верификация состоит из:

1. **Подтверждение purview**: `find /Users/dev/openwhispr-server -name "docker-compose*.yml" -not -path "*/node_modules/*"` → должно совпасть с 13 файлами, перечисленными в разделах A/C
2. **Подтверждение Helm chart**: `helm lint /Users/dev/openwhispr-server/charts/openwhispr` → должно вернуть 0 failures (текущий baseline; находки B1–B10 не ловятся lint'ом)
3. **Подтверждение паритета-линтера**: `pnpm exec tsx /Users/dev/openwhispr-server/tools/lint-compose-chart-parity.ts` → текущее покрытие; решит ли он находки C5 — нужно проверить
4. **Подтверждение CNPG image enforcement**: `grep -E '"\^\.\+:17\\\\.\[0-9\]\+\.\*\$"' /Users/dev/openwhispr-server/charts/openwhispr/values.schema.json` → находит pattern enforcement

После того как соответствующие fix-фазы будут запланированы и выполнены, гейт PASS = повторный аудит этим же планом возвращает 0 BLOCKER / 0 HIGH в разделах A и B.
