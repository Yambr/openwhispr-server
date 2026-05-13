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
{{- printf "%s-pg-pooler-rw" (include "openwhispr.fullname" .) -}}
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
