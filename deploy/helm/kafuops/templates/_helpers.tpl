{{- define "kafuops.name" -}}
kafuops
{{- end -}}

{{- define "kafuops.labels" -}}
app.kubernetes.io/name: kafuops
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: kafuops-{{ .Chart.Version }}
{{- end -}}

{{/* Name of the Secret to reference (existing or chart-managed). */}}
{{- define "kafuops.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{ .Values.secrets.existingSecret }}
{{- else -}}
{{ .Release.Name }}-kafuops-secrets
{{- end -}}
{{- end -}}
