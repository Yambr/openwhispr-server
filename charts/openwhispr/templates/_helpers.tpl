{{/*
Expand the name of the chart.
*/}}
{{- define "openwhispr.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
Truncated at 63 chars (DNS label limit).
*/}}
{{- define "openwhispr.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version label.
*/}}
{{- define "openwhispr.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "openwhispr.labels" -}}
helm.sh/chart: {{ include "openwhispr.chart" . }}
{{ include "openwhispr.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "openwhispr.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openwhispr.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "openwhispr.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "openwhispr.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Pooler RW service hostname — built by CNPG operator for the Pooler CR.
Pattern: <fullname>-pg-pooler-rw (per Plan 09-05 / pooler.yaml comments).
*/}}
{{- define "openwhispr.poolerHost" -}}
{{/* Phase 09.2 F36 — CNPG Pooler CR creates a single Service named after
the Pooler resource (no `-rw` suffix; only Cluster CR creates -rw/-r/-ro
variants). Was: <fullname>-pg-pooler-rw → 500 EAI_AGAIN on every signup. */}}
{{- printf "%s-pg-pooler" (include "openwhispr.fullname" .) -}}
{{- end }}

{{/*
CNPG primary read-write service hostname (used by migrate Job, which bypasses
the Pooler because PgBouncer transaction-mode breaks Drizzle DDL — see 09-08).
Pattern: <fullname>-pg-rw (CNPG operator default).
*/}}
{{- define "openwhispr.postgresRwHost" -}}
{{- printf "%s-pg-rw" (include "openwhispr.fullname" .) -}}
{{- end }}

{{/*
wait-for-migrate initContainer — used by api/web/worker Deployments so the
container only starts after the migrate Job's Complete condition is true.
Finding 09.1-F3: on `helm install` migrate is a regular Job (not a hook)
applied alongside the Cluster CR, so the application Deployments need to
poll for its completion before serving traffic / processing jobs.
The kubectl image is pinned by digest in values.yaml so the polling
container is auditable + reproducible.
*/}}
{{- define "openwhispr.waitForMigrateInitContainer" -}}
- name: wait-for-migrate
  # Finding 09.1-F5 → 09.1-F19 — bitnami/kubectl:1.30.4 returns 404 from
  # Docker Hub (Bitnami Secure Images migration); the upstream
  # registry.k8s.io/kubectl image is DISTROLESS (no /bin/sh), so the
  # `sh -c` poll loop below cannot exec. alpine/kubectl ships a full
  # busybox shell + kubectl binary; semver-pinned tags are published.
  image: alpine/kubectl:1.34.2
  imagePullPolicy: IfNotPresent
  command:
    - sh
    - -c
    - |
      # Finding 09.1-F10 — migrate Job is a regular release resource with
      # `.Release.Revision`-suffixed name. Query by label selector + sort
      # by creationTimestamp + slice [-1:] so we always watch THIS
      # release's Job, not a stale prior-revision one.
      # 300 iterations × 2s = 600s wall-time ceiling — matches the
      # migrate Job's wait-for-postgres + actual migration budget.
      SELECTOR='app.kubernetes.io/component=migrate,app.kubernetes.io/instance={{ .Release.Name }}'
      i=0
      until [ "$(kubectl get jobs -n {{ .Release.Namespace }} -l "$SELECTOR" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].status.succeeded}' 2>/dev/null)" = "1" ]; do
        i=$((i+1))
        if [ $i -gt 300 ]; then
          echo "FATAL: migrate Job (selector $SELECTOR) not Complete after 600s" 1>&2
          exit 1
        fi
        echo "waiting for migrate Job ... ($i/300)"
        sleep 2
      done
      echo "migrate Job Complete"
{{- end }}

{{/*
Bitnami Valkey sub-chart primary service hostname.
Sub-charts render as <Release.Name>-<chart-name>-<role>, so the primary is
<release>-valkey-primary.
*/}}
{{- define "openwhispr.valkeyHost" -}}
{{- printf "%s-valkey-primary" .Release.Name -}}
{{- end }}

{{/*
Bitnami MinIO sub-chart service hostname.
Pattern: <release>-minio (no role suffix in standalone).
*/}}
{{- define "openwhispr.minioHost" -}}
{{- printf "%s-minio" .Release.Name -}}
{{- end }}

{{/*
LiteLLM service hostname (Wave 2 Plan 09-07).
Embedded mode: http://<fullname>-litellm:4000
External mode: returns values.litellm.externalBaseUrl verbatim.
*/}}
{{- define "openwhispr.litellmBaseUrl" -}}
{{- if .Values.litellm.embedded -}}
{{- printf "http://%s-litellm:4000" (include "openwhispr.fullname" .) -}}
{{- else -}}
{{- required "values.litellm.externalBaseUrl is required when litellm.embedded=false" .Values.litellm.externalBaseUrl -}}
{{- end -}}
{{- end }}

{{/*
Selector labels for the api workload.
*/}}
{{- define "openwhispr.api.selectorLabels" -}}
{{ include "openwhispr.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Selector labels for the worker workload.
*/}}
{{- define "openwhispr.worker.selectorLabels" -}}
{{ include "openwhispr.selectorLabels" . }}
app.kubernetes.io/component: worker
{{- end }}

{{/*
Selector labels for the web workload.
*/}}
{{- define "openwhispr.web.selectorLabels" -}}
{{ include "openwhispr.selectorLabels" . }}
app.kubernetes.io/component: web
{{- end }}

{{/*
Selector labels for the litellm workload (Wave 2 Plan 09-07).
*/}}
{{- define "openwhispr.litellm.selectorLabels" -}}
{{ include "openwhispr.selectorLabels" . }}
app.kubernetes.io/component: litellm
{{- end }}

{{/*
The 8 secret env keys carried by <fullname>-secrets. Used by the
secret-presence-probe initContainer to fail-fast at pod start if ESO has
not synced yet (pitfall #5).
*/}}
{{- define "openwhispr.secretPresenceProbeCmd" -}}
sh -c 'for k in LITELLM_MASTER_KEY OPENROUTER_API_KEY OPENAI_API_KEY PYANNOTE_API_KEY HF_TOKEN POSTGRES_OWNER_PASSWORD PGBOUNCER_ADMIN_PASSWORD BETTER_AUTH_SECRET; do eval v=\$$k; if [ -z "$v" ]; then echo "FATAL: $k empty — refusing to start (ESO not synced?)"; exit 1; fi; done; echo "secret-presence-probe OK"'
{{- end }}

{{/*
Common envFrom secret reference block, used by api / worker / litellm pods.
*/}}
{{- define "openwhispr.secretEnvFrom" -}}
- secretRef:
    name: {{ include "openwhispr.fullname" . }}-secrets
{{- end }}
