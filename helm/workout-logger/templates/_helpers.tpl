{{/*
Expand the name of the chart.
*/}}
{{- define "workout-logger.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a fully qualified app name.
*/}}
{{- define "workout-logger.fullname" -}}
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
Create the chart name and version label.
*/}}
{{- define "workout-logger.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels for all chart resources.
*/}}
{{- define "workout-logger.labels" -}}
helm.sh/chart: {{ include "workout-logger.chart" . }}
{{ include "workout-logger.selectorLabels" . }}
{{- $appVersion := default .Chart.AppVersion .Values.env.APP_VERSION }}
{{- if $appVersion }}
app.kubernetes.io/version: {{ $appVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels for workload and service resources.
*/}}
{{- define "workout-logger.selectorLabels" -}}
app.kubernetes.io/name: {{ include "workout-logger.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Labels for web Pods selected by the application Service.
*/}}
{{- define "workout-logger.webLabels" -}}
{{ include "workout-logger.selectorLabels" . }}
app.kubernetes.io/component: web
{{- end }}

{{/*
Labels for migration Pods, which must never match the application Service.
*/}}
{{- define "workout-logger.migrationLabels" -}}
{{ include "workout-logger.selectorLabels" . }}
app.kubernetes.io/component: migration
{{- end }}

{{/*
Create the service account name.
*/}}
{{- define "workout-logger.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "workout-logger.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* Existing Secret containing the API key; the chart never creates secret data. */}}
{{- define "workout-logger.secretName" -}}
{{- required "existingSecret must name an externally managed Kubernetes Secret" .Values.existingSecret -}}
{{- end }}

{{/* Backup PVC name, allowing an independently managed claim. */}}
{{- define "workout-logger.backupClaimName" -}}
{{- default (printf "%s-backups" (include "workout-logger.fullname" .)) .Values.backupPersistence.existingClaim }}
{{- end }}

{{/* Labels for maintenance Pods, which must never match the web Service. */}}
{{- define "workout-logger.maintenanceLabels" -}}
{{ include "workout-logger.selectorLabels" . }}
app.kubernetes.io/component: maintenance
{{- end }}

{{/*
Return the image reference used by the application container.
*/}}
{{- define "workout-logger.image" -}}
{{- if .Values.image.digest }}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest }}
{{- else }}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}
{{- end }}
