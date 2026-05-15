# Kubernetes Deployment

KafuOps can be deployed in Kubernetes as sidecars, DaemonSets, and central workers.

## Recommended architecture

```text
app namespace
  api-service pod
    api container
    kafuops-agent sidecar

kafuops namespace
  kafuops-api deployment
  kafuops-worker deployment
  postgres or external storage
```

## Sidecar example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
spec:
  template:
    spec:
      containers:
        - name: api
          image: your-api:latest
        - name: kafuops-agent
          image: kafuops/agent:latest
          env:
            - name: KAFUOPS_CONFIG
              value: /config/.kafuops.yml
          volumeMounts:
            - name: kafuops-config
              mountPath: /config
      volumes:
        - name: kafuops-config
          configMap:
            name: kafuops-config
```

## Worker deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kafuops-worker
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: worker
          image: kafuops/worker:latest
          env:
            - name: OPENAI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: kafuops-secrets
                  key: openai-api-key
            - name: KAFUOPS_GIT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: kafuops-secrets
                  key: git-token
```

## OpenTelemetry Collector

KafuOps can receive telemetry from an OpenTelemetry Collector exporter or run as a processor-like sidecar in future versions.

## Safety recommendations

- Run patch generation in a restricted namespace.
- Disable cluster-admin permissions.
- Do not mount Kubernetes secrets into patch sandboxes.
- Use network policies to limit outbound access.
- Require approval for infrastructure changes.
