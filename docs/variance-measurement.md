# The repeat run: pinning down run-to-run variance

**Status: scheduled, blocked on quota until 2026-09-15.** Today's budget went
to run 4 (~392 of 500 requests). A second run does not fit, and forcing it
produces exactly the incomplete run whose numbers are not usable.

## Why

A 95% ship bar is currently unmeasurable. Cases whose sources did not change
between two runs flip verdict anyway — 4 of ~68 in run 3 → run 4 (5.9%), and
2 of 17 in the A/B control group (11.8%), the cleanest measurement available
because corpus and configuration were identical. That puts the run-to-run
standard deviation of suite accuracy at ±3 to ±4.8 percentage points.

A single run therefore cannot distinguish 95% from 91%, and both estimates rest
on samples of 17 and 68. The bar is a number nobody can currently reproduce.

## What to run

Two consecutive runs at **byte-identical inputs** — same corpus, same commit,
same `retrieval_admits`, same model, no ingest in between. One per day, two
days.

```bash
pnpm evals run -- --suite en-core --out var-1.md --out-json var-1.json
# next day, nothing else against the key
pnpm evals run -- --suite en-core --out var-2.md --out-json var-2.json
```

Then, per case, the flip rate across the pair. **Every flip is variance**,
because nothing else changed. That is a direct measurement on 103 cases rather
than an inference from 17.

Confirm before reading anything: `incompleteCases` is 0 in both. A run that hit
the wall measures the wall.

## What to report

Not just the number. The question is what bar the measurement supports:

- the per-case flip rate, and the resulting standard deviation of accuracy
- **the smallest accuracy difference a single run can actually resolve**
- how many runs a 95% bar would need at that variance, and therefore how many
  days
- whether the variance is concentrated — if most flips are a handful of
  genuinely borderline cases, naming them is more useful than the aggregate,
  and they may be better fixed than averaged over
- the options, costed: more runs, a paid key, a larger golden set, or a
  different metric entirely — a bar on fabricated literals and uncited claims
  is already deterministic and already passes, and may be the honest bar

## Until then

`BAR_IS_PROVISIONAL` in `packages/evals/src/runner.ts` keeps `meetsShipBar`
false and puts the caveat in every report. Flipping it is one deliberate edit,
and `packages/evals/test/suite.test.ts` fails if it happens without this
measurement landing first.
