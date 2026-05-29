# OpenTelemetry Integration

OpenTelemetry is a native telemetry input for KafuOps.

## Receiver (implemented)

KafuOps exposes an **OTLP/HTTP JSON** trace receiver on the agent:

```
POST /v1/otel/traces      (Content-Type: application/json)
```

Enable it in config:

```yaml
observability:
  opentelemetry:
    enabled: true           # the endpoint returns 404 until enabled
```

Point an OpenTelemetry Collector at it with the OTLP HTTP exporter (JSON
encoding). For each span that has an **error status** (`status.code == 2`) or an
**`exception` span event**, KafuOps emits a redacted incident event, extracting
`exception.type` / `exception.message` / `exception.stacktrace` and the route
(`http.route`). If `KAFUOPS_WEBHOOK_SECRET` is set, the endpoint also requires an
`Authorization: Bearer <secret>` header.

> **Note:** only the OTLP **JSON** encoding is parsed today. A collector
> configured for protobuf gets a clear `415` response — set the exporter to JSON.

## Supported signals

- Traces.
- Span events.
- Error status codes.
- Resource attributes.
- Service names.
- Deployment versions.
- Logs when available.

## Configuration

```yaml
observability:
  opentelemetry:
    enabled: true
    endpoint: http://localhost:4318
    service_name: api-service
```

## Useful attributes

KafuOps should use:

```text
service.name
service.version
deployment.environment
http.route
http.method
http.status_code
exception.type
exception.message
exception.stacktrace
code.filepath
code.function
code.lineno
```

## Incident creation

An incident can be created when:

- A span has error status.
- Exception events repeat.
- A route's 5xx rate crosses a threshold.
- A trace contains a known failing stack trace.

## Context selection

OpenTelemetry helps KafuOps connect:

```text
trace -> route -> service method -> source file -> test file
```
