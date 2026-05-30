# Demo: KafuOps fixes a real incident

A tiny checkout service with a **planted bug** in `src/discount.js`: a percentage
discount is computed as if `percent` were a fraction, so `applyDiscount(100, 20)`
returns `-1900` instead of `80`. `test.js` fails until it's fixed.

Watch KafuOps diagnose it, write the fix, validate it in a sandbox, and open a
reviewable MR — driven by your locally-installed **Claude CLI** (no API key).

## Run it

From the repo root:

```bash
npm run build
scripts/demo.sh
```

`scripts/demo.sh` copies this project to a temp dir, registers an incident
pointing at the failing frame, and runs:

```bash
kafuops incidents open-mr <id> --in-place --dry-run
```

Real output from this exact demo (Claude CLI provider):

```
$ node test.js
AssertionError: 20% off $100 should be $80   (got -1900)

$ kafuops incidents open-mr inc_demo_discount
✓ tests passed   confidence=80 (high)   risk=low
! MR ready for review — saved mr-body.md
```

The generated fix:

```diff
- return price - price * percent;
+ return price - price * (percent / 100);
```

Swap the provider in `.kafuops.yml` (`openai` / `anthropic` with a key, or
`codex`) to run it through a different model.
