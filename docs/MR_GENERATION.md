# Merge Request and Pull Request Generation

KafuOps opens reviewable merge requests based on production incidents.

It should not auto-merge by default.

## MR creation flow

```text
incident
  -> evidence packet
  -> context bundle
  -> root cause analysis
  -> patch plan
  -> failing test
  -> code patch
  -> validation
  -> branch
  -> MR/PR
```

## Branch naming

```text
kafuops/fix/<incident-id>-<short-summary>
```

Example:

```text
kafuops/fix/inc-123-checkout-null-payment-method
```

## MR title

```text
[KafuOps] Fix checkout error when payment method is missing
```

## MR body template

```md
# KafuOps Incident Fix

## Incident

- Incident ID: inc_123
- Service: api-service
- Environment: production
- Route/job: POST /checkout
- First seen: 2026-05-15T10:24:00Z
- Event count: 18
- Severity: high

## Root cause

The retry handler assumed `customer.defaultPaymentMethod` was always present.
Production evidence shows the value can be missing for new customers.

## Evidence

- Top stack frame: `src/payment/retry.ts:42`
- Trace route: `POST /checkout`
- Similar previous incident: `inc_091`
- First observed 18 minutes after deploy `abc123`

## Files inspected

- `src/payment/retry.ts`
- `src/payment/customer.ts`
- `src/routes/checkout.ts`
- `tests/payment/retry.test.ts`

## Files changed

- `src/payment/retry.ts`
- `tests/payment/retry.test.ts`

## Validation

- Added regression test for missing default payment method.
- Ran `npm test -- retry.test.ts`.
- Result: passed.

## Confidence

Score: 84 / 100

Positive signals:
- Stack trace maps directly to changed file.
- Regression test reproduces failure.
- Patch is small.
- No public API change.

Negative signals:
- Full integration test with payment gateway was not run.

## Blast radius

Affected paths:
- `POST /checkout`
- Payment retry flow

Unaffected paths:
- Refund flow
- Payment capture flow
- Customer creation

## Grounding manifest

See `.kafuops/audit/model-calls/inc_123-grounding.md`.

## Rollback

Revert this MR. The change is limited to retry behavior and one test file.
```

## MR labels

Recommended labels:

```text
kafuops
auto-generated
incident-fix
needs-review
confidence-high
```

## MR safety gates

KafuOps should open an MR only if:

- The incident passed trigger policy.
- Redaction completed.
- Context bundle was audited.
- Patch applied cleanly.
- Tests ran, or the MR clearly says tests could not run.
- Policy allows modifying the files.

## When not to open an MR

KafuOps should avoid opening a code MR when:

- The issue is clearly a third-party outage.
- The issue is a missing environment variable.
- The issue is a data-only incident.
- The fix would require destructive migration.
- The confidence score is below policy threshold.
- Sensitive files would need changes without approval.

In these cases, KafuOps should create an incident report instead.
