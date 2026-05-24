{{/*
Expand the name of the chart.
*/}}
{{- define "openwhispr-postgres.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name. Truncated at 63 chars (DNS label limit).
*/}}
{{- define "openwhispr-postgres.fullname" -}}
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
{{- define "openwhispr-postgres.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "openwhispr-postgres.labels" -}}
helm.sh/chart: {{ include "openwhispr-postgres.chart" . }}
{{ include "openwhispr-postgres.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "openwhispr-postgres.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openwhispr-postgres.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
CNPG Cluster name. Pattern: <fullname>-pg.
*/}}
{{- define "openwhispr-postgres.clusterName" -}}
{{- printf "%s-pg" (include "openwhispr-postgres.fullname" .) -}}
{{- end }}

{{/*
Owner password Secret name (consumed by CNPG bootstrap.initdb.secret + by
the application chart's migrate Job via `database.passwordSecretRef`).
Stable name regardless of secrets.mode so cross-chart refs work.
*/}}
{{- define "openwhispr-postgres.ownerSecretName" -}}
{{- printf "%s-pg-owner" (include "openwhispr-postgres.fullname" .) -}}
{{- end }}

{{/*
App-role password Secret name (consumed by CNPG managed.roles + by the
application chart's api/web/worker Deployments).
*/}}
{{- define "openwhispr-postgres.appSecretName" -}}
{{- printf "%s-pg-app" (include "openwhispr-postgres.fullname" .) -}}
{{- end }}

{{/*
S3 backup-credentials Secret name (consumed by CNPG barmanObjectStore).
*/}}
{{- define "openwhispr-postgres.backupSecretName" -}}
{{- printf "%s-pg-backup" (include "openwhispr-postgres.fullname" .) -}}
{{- end }}
