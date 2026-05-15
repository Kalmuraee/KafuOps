# Glossary

## Agent

A KafuOps process that runs near the backend runtime and observes logs, traces, alerts, and errors.

## Architecture graph

A structured map of routes, services, data models, queues, external APIs, and tests.

## Blast radius

The set of routes, jobs, services, dependencies, and data flows that may be affected by a change.

## Context bundle

The selected source files, tests, memory snippets, and sanitized runtime evidence used for model analysis.

## Evidence packet

Sanitized production evidence for an incident, such as stack traces, trace spans, log excerpts, and deploy metadata.

## Fingerprint

A stable identifier for grouping similar errors.

## Grounding manifest

An audit file that records exactly what context was sent to the model and why.

## Incident

A grouped production issue that passed trigger rules and may require analysis.

## Project memory

Human-readable and model-readable files that describe the backend architecture and incident history.

## Sidecar mode

A runtime mode where KafuOps runs beside the backend rather than running the backend inside itself.

## Wrapper mode

A runtime mode where KafuOps starts the backend as a child process using `kafuops run -- <command>`.
