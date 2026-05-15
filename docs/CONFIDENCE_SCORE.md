# Confidence Score

KafuOps assigns a confidence score to every generated fix.

The score is not a guarantee. It is a review aid.

## Score range

```text
0-39   Low confidence. Do not open MR automatically.
40-69  Medium confidence. Human approval required before MR.
70-89  High confidence. MR can be opened automatically if policy allows.
90-100 Very high confidence. Still no auto-merge by default.
```

## Positive signals

- Stack trace maps directly to changed file.
- Trace spans include the route/job connected to changed file.
- Similar incident was fixed before.
- Recent deploy changed the same file.
- Regression test reproduces the failure.
- Targeted tests pass.
- Patch is small.
- No public API change.
- No database migration.
- No auth or permission logic touched.

## Negative signals

- No stack trace.
- Error message is generic.
- Logs are heavily redacted.
- No tests exist.
- Tests could not run.
- Patch touches high-risk files.
- Patch changes auth, payments, encryption, migrations, or permissions.
- Root cause depends on missing production-only data.
- Model had to infer too much.

## Example score output

```yaml
confidence:
  score: 82
  level: high
  positive:
    - stack_trace_maps_to_changed_file
    - regression_test_added
    - targeted_tests_passed
    - patch_is_small
  negative:
    - integration_test_not_run
  decision: open_mr
```

## Policy example

```yaml
confidence_policy:
  open_mr_if_score_at_least: 70
  require_human_approval_if_below: 85
  never_auto_merge: true
  block_if_touches:
    - auth
    - encryption
    - destructive_migration
```
