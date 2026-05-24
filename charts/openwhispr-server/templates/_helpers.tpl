{{/*
Expand the name of the chart.
*/}}
{{- define "openwhispr-server.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name. Truncated at 63 chars (DNS label limit).
*/}}
{{- define "openwhispr-server.fullname" -}}
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
{{- define "openwhispr-server.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "openwhispr-server.labels" -}}
helm.sh/chart: {{ include "openwhispr-server.chart" . }}
{{ include "openwhispr-server.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (release-scoped).
*/}}
{{- define "openwhispr-server.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openwhispr-server.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Component-scoped selector labels.
*/}}
{{- define "openwhispr-server.api.selectorLabels" -}}
{{ include "openwhispr-server.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{- define "openwhispr-server.web.selectorLabels" -}}
{{ include "openwhispr-server.selectorLabels" . }}
app.kubernetes.io/component: web
{{- end }}

{{- define "openwhispr-server.worker.selectorLabels" -}}
{{ include "openwhispr-server.selectorLabels" . }}
app.kubernetes.io/component: worker
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "openwhispr-server.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "openwhispr-server.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Operator-supplied Secret name carrying the chart-owned env keys
(BETTER_AUTH_SECRET, MASTER_KEK, PYANNOTE_API_KEY, TAVILY_API_KEY,
YANDEX_SEARCH_API_KEY, YANDEX_FOLDER_ID). When `secrets.secretName` is
empty the default is `<fullname>-secrets`. Consumed by api/web/worker
Deployments via envFrom.

Note: in `secrets.mode: external-managed` the chart does NOT render
this Secret; the operator pre-creates it. In `secrets.mode: helm-values`
the chart renders a Secret of the same name from `secrets.values`
(undocumented fallback — see templates/secrets.yaml).
*/}}
{{- define "openwhispr-server.secretsName" -}}
{{- default (printf "%s-secrets" (include "openwhispr-server.fullname" .)) .Values.secrets.secretName -}}
{{- end }}

{{/*
ConfigMap name carrying the non-secret env keys (NODE_ENV, LOG_LEVEL,
plus anything else the operator puts under `.Values.env`).
*/}}
{{- define "openwhispr-server.configName" -}}
{{- printf "%s-config" (include "openwhispr-server.fullname" .) -}}
{{- end }}
