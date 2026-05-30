# Kubernetes Deployment

KafuOps ships **ready-to-apply manifests and a Helm chart** for the agent +
worker. Use either:

```bash
# Raw manifests
kubectl apply -f deploy/kubernetes/         # see deploy/kubernetes/README.md

# Or Helm
helm install kafuops deploy/helm/kafuops \
  --set secrets.existingSecret=kafuops-secrets \
  --set worker.repoCloneUrl=https://github.com/your-org/your-backend.git
```

Both deploy a `kafuops-agent` Deployment+Service (webhook + OTLP intake, with
`/healthz` probes) and a `kafuops-worker` Deployment (clones the repo via an
init-container, drives incidents → MRs). Config comes from a ConfigMap, secrets
from a Secret, incident state from a PVC. The example configs are validated
against the real Zod schema.

> A first-class **operator / CRD** is on the roadmap — the manifests + chart
> above already cover deployment; the operator would add reconcile-loop
> management on top. Not required to run KafuOps in a cluster.

## Reference architecture

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
