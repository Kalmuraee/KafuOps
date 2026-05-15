# Project Memory

Project memory is the living knowledge base KafuOps creates for the backend.

It is stored in the repository so humans and agents can review it.

```text
.kafuops/memory/
  project.md
  architecture.md
  file-tree.md
  routes.md
  services.md
  data.md
  queues.md
  external-apis.md
  observability.md
  tests.md
  deployments.md
  incidents.md
  fix-history.md
  review-feedback.md
```

## Why memory matters

A coding agent that reads the repo once is useful. A debugging agent that remembers how production actually fails is much more useful.

KafuOps should learn:

- How the backend is structured.
- Which files own which routes and jobs.
- Which services call each other.
- Which database tables are touched.
- Which tests cover which files.
- Which incidents happened before.
- Which fixes worked.
- Which model-generated fixes were rejected by reviewers.

## Memory generation

Run:

```bash
kafuops scan
```

The scanner should generate summaries like:

```md
# Routes

## POST /checkout

Handler: `src/routes/checkout.ts#createCheckout`
Calls:
- `src/services/payment-service.ts`
- `src/services/cart-service.ts`
- `src/clients/inventory-client.ts`

Tests:
- `tests/routes/checkout.test.ts`
- `tests/payment/payment-service.test.ts`
```

## Memory update triggers

KafuOps should update memory when:

- A new incident is created.
- An MR is opened.
- An MR is merged.
- An MR is rejected.
- A reviewer leaves corrective feedback.
- The repository structure changes significantly.
- A new route, service, queue, or migration appears.

## Incident memory

Each incident creates a memory record:

```md
# Incident inc_2026_05_15_checkout_default_payment

First seen: 2026-05-15T10:24:00Z
Service: api-service
Route: POST /checkout
Environment: production
Fingerprint: payment_retry_missing_default_method

## Symptoms

- HTTP 500 on checkout.
- Stack trace points to `src/payment/retry.ts:42`.
- Started after deploy `abc123`.

## Root cause

`customer.defaultPaymentMethod` can be undefined for new customers.

## Fix

Added explicit fallback handling and regression test.

## MR

Provider: GitLab
MR: !482
Status: merged

## Lessons

When payment retry errors happen on checkout, inspect customer payment method hydration before changing gateway retry behavior.
```

## Memory quality rules

Good memory is:

- Specific.
- Linked to files and incidents.
- Updated after human review.
- Short enough to fit into model context.
- Clear enough for humans to read.

Bad memory is:

- A huge generic summary.
- Full copied source code.
- Untested model speculation.
- Private data or secrets.
- Stale after the architecture changes.

## Suggested memory schema

```yaml
memory_version: 1
project:
  name: api-service
  language: typescript
  framework: express
routes:
  - method: POST
    path: /checkout
    handler: src/routes/checkout.ts#createCheckout
    calls:
      - src/services/payment-service.ts
    tests:
      - tests/routes/checkout.test.ts
incidents:
  - id: inc_123
    fingerprint: payment_retry_missing_default_method
    files_changed:
      - src/payment/retry.ts
      - tests/payment/retry.test.ts
```
