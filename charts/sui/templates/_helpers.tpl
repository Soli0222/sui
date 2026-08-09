{{/*
Expand the name of the chart.
*/}}
{{- define "sui.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "sui.fullname" -}}
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
Create chart name and version as used by the chart label.
*/}}
{{- define "sui.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "sui.labels" -}}
helm.sh/chart: {{ include "sui.chart" . }}
{{ include "sui.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "sui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "sui.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "sui.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Resolve the PostgreSQL host.
*/}}
{{- define "sui.postgresql.host" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "%s-postgresql" (include "sui.fullname" .) }}
{{- else }}
{{- required "externalPostgres.host is required when postgresql.enabled=false" .Values.externalPostgres.host }}
{{- end }}
{{- end }}

{{/*
Resolve the PostgreSQL port.
*/}}
{{- define "sui.postgresql.port" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.service.port }}
{{- else }}
{{- .Values.externalPostgres.port }}
{{- end }}
{{- end }}

{{/*
Resolve the PostgreSQL database.
*/}}
{{- define "sui.postgresql.database" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.database }}
{{- else }}
{{- required "externalPostgres.database is required when postgresql.enabled=false" .Values.externalPostgres.database }}
{{- end }}
{{- end }}

{{/*
Resolve the PostgreSQL user.
*/}}
{{- define "sui.postgresql.user" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.user }}
{{- else }}
{{- required "externalPostgres.user is required when postgresql.enabled=false" .Values.externalPostgres.user }}
{{- end }}
{{- end }}

{{/*
Resolve the PostgreSQL password secret name.
*/}}
{{- define "sui.postgresql.secretName" -}}
{{- if .Values.postgresql.enabled }}
{{- default (printf "%s-postgresql" (include "sui.fullname" .)) .Values.postgresql.auth.existingSecret }}
{{- else }}
{{- required "externalPostgres.existingSecret is required when postgresql.enabled=false" .Values.externalPostgres.existingSecret }}
{{- end }}
{{- end }}

{{/*
Resolve the PostgreSQL password secret key.
*/}}
{{- define "sui.postgresql.secretKey" -}}
{{- if .Values.postgresql.enabled }}
{{- default "POSTGRES_PASSWORD" .Values.postgresql.auth.existingSecretKey }}
{{- else }}
{{- default "password" .Values.externalPostgres.existingSecretKey }}
{{- end }}
{{- end }}

{{/*
Resolve the PostgreSQL PVC name.
*/}}
{{- define "sui.postgresql.pvcName" -}}
{{- if .Values.postgresql.persistence.existingClaim }}
{{- .Values.postgresql.persistence.existingClaim }}
{{- else }}
{{- printf "%s-postgresql" (include "sui.fullname" .) }}
{{- end }}
{{- end }}
