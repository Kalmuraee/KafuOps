# OpenTelemetry Integration

OpenTelemetry should be the preferred native telemetry format for KafuOps.

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
