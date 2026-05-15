# Blast-Radius Analysis

Blast-radius analysis explains what a generated fix could affect.

Every KafuOps MR should answer:

```text
What could this break?
Which routes/jobs are affected?
Which dependencies are touched?
Which tests cover the change?
Which production errors are related?
```

## Inputs

- Architecture graph.
- Import graph.
- Runtime trace paths.
- Files changed.
- Tests linked to changed files.
- Previous incidents.
- Config and migration impact.

## Output example

```md
## Blast radius

Changed file: `src/payment/retry.ts`

Potentially affected:
- POST /checkout
- POST /subscriptions/:id/retry-payment
- payment retry worker

Not directly affected:
- refund flow
- customer creation
- inventory reservation

External dependencies:
- Stripe client may receive fewer invalid retry attempts.

Data impact:
- No schema change.
- No migration.
- No persisted data mutation change outside retry branch.

Risk level: low
```

## Risk levels

```text
low       Small conditional fix, covered by tests, no external contract change.
medium    Changes behavior across multiple routes or jobs.
high      Auth, payment, permissions, migrations, infrastructure, or data deletion.
critical  Could affect production availability or security boundaries.
```

## Policy use

```yaml
blast_radius_policy:
  block_high_risk_auto_mr: true
  require_approval_for:
    - auth
    - payments
    - migrations
    - permissions
    - infrastructure
```
