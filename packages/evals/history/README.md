# Eval run history

Exported 2026-10-11, before the project moved off the machine it was built on.
Until now this history lived only in the local development database, which does
not move with the code. It is the evidence behind the claims in
[docs/where-this-stands.md](../../../docs/where-this-stands.md): zero fabricated
literals across the full runs, the run 4 / run 5 variance pair, and the twelve
flips that turned out to be two correct behaviours each.

**These numbers are stale.** Every run here predates Phase 4, which changed the
system prompt, the `lookup_order` output, the golden set's order numbers and the
case count. They are history, not current measurements. The next run
re-baselines.

## What is here

| File                                                                                                     | What it is                                                                                    | Backs                                           |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [eval-runs.json](eval-runs.json)                                                                         | Every row of the `eval_runs` table: one summary per run, 11 runs                              | the run-by-run figures                          |
| [printed/\*-report.txt](printed/)                                                                        | Six run reports, exactly as the runner printed them                                           | per-run accuracy, gate interventions, notes     |
| [printed/...-variance-run4-run5-summary.txt](printed/2026-09-15T1009-variance-run4-run5-summary.txt)     | Run 4 against run 5 at the same commit: the twelve verdict flips                              | "twelve of 103 cases disagreed"                 |
| [printed/...-variance-run4-run5-cases.txt](printed/2026-09-15T1010-variance-run4-run5-cases.txt)         | The replies on both sides of seven of those flips, verbatim                                   | "every flip was between two correct behaviours" |
| [printed/...-variance-run4-run5-behaviour.txt](printed/2026-09-16T0846-variance-run4-run5-behaviour.txt) | Behaviour, not verdict, on the flipping cases                                                 | the adjudications                               |
| [printed/...-variance-runs-4-5-6.txt](printed/2026-09-16T0955-variance-runs-4-5-6.txt)                   | Behaviour instability across runs 4, 5 and 6; which flips were absorbed and which four remain | "four cases are the whole quality problem"      |
| [../adjudications.json](../adjudications.json)                                                           | The ten expectation changes, each with the replies and corpus evidence that forced it         | every reclassified case                         |

Everything under `printed/` was recovered **verbatim** from the build session's
transcript: it is what the tools printed at the time, with a header line giving
the time it was printed. Nothing in it has been edited.

## The runs

| Started (UTC)                                       | Commit    | Reranker | Cases | Passed / failed | Accuracy | Gate caught: literals / citations | p95 ms | Note                                                                   |
| --------------------------------------------------- | --------- | -------- | ----- | --------------- | -------- | --------------------------------- | ------ | ---------------------------------------------------------------------- |
| 2026-09-10 23:13                                    | `87b6620` | fusion   | 33    | 19 / 14         | 57.6%    | 8 / 3                             | 8,805  | 33-case run                                                            |
| 2026-09-10 23:23                                    | `e224014` | fusion   | 33    | 25 / 8          | 75.8%    | 0 / 3                             | 9,140  | 33-case run                                                            |
| 2026-09-10 23:30                                    | `e224014` | fusion   | 33    | 24 / 9          | 72.7%    | 0 / 5                             | 11,382 | 33-case run                                                            |
| 2026-09-12 13:10                                    | `e6e9f2b` | llm      | 102   | 70 / 32         | 68.6%    | 3 / 11                            | 6,966  | 102-case run                                                           |
| 2026-09-12 13:57                                    | `0f8a3dc` | llm      | 103   | 48 / 55         | 46.6%    | 0 / 1                             | 8,966  | 103 cases; printed report survives                                     |
| 2026-09-13 21:45                                    | `ba9209e` | llm      | 103   | 78 / 25         | 75.7%    | 0 / 8                             | 33,845 | 103 cases; **incomplete** — 5 cases never reached the model; worst p95 |
| 2026-09-13 21:51                                    | `ba9209e` | llm      | 1     | 0 / 1           | 0.0%     | 0 / 0                             | 1,779  | 1-case probe                                                           |
| 2026-09-13 22:08                                    | `24c4278` | llm      | 30    | 21 / 9          | 70.0%    | 0 / 1                             | 7,115  | 30-case run                                                            |
| 2026-09-14 08:01                                    | `c9b4dc5` | llm      | 103   | 83 / 20         | 80.6%    | 0 / 9                             | 8,091  | **run 4** of the variance pair                                         |
| 2026-09-15 10:08                                    | `8cd710e` | llm      | 103   | 81 / 22         | 78.6%    | 0 / 8                             | 6,591  | **run 5** of the variance pair                                         |
| 2026-09-16 09:54                                    | `46410b8` | llm      | 103   | 83 / 20         | 80.6%    | 0 / 8                             | 9,254  | **run 6**; first report under the ADR 0011 bar                         |
| How to read three columns that are easy to misread: |

- **Accuracy** is against expectations as they stood at the time, on a drafted
  suite nobody at the merchant has signed. It is not comparable across runs
  where cases were adjudicated in between, and it was never a quality claim.
- **Gate caught** is how often the gate **withheld** a reply, not how often a
  fabrication reached anyone. Under [ADR 0011](../../../docs/adr/0011-the-bar.md)
  the property is "fabricated literals reaching a customer", and that is zero in
  every run here, because the gate inspects every reply. Every literal the gate
  ever caught was investigated; each was the gate refusing a correct answer, and
  each class was fixed.
- **Runs 4, 5 and 6** are identified by their accuracy matching the variance
  printouts (80.6% and 78.6%). The earlier runs had numbers in conversation that
  the database never recorded, so they are not numbered here rather than
  numbered from memory.

## 2026-10-11 re-baseline

[2026-10-11-run.md](2026-10-11-run.md) and [2026-10-11-run.json](2026-10-11-run.json):
the first run after Phase 4, on commit `f9f35eb`, against the mock store
(`--store mock`), 108 cases. The JSON holds every case's outcome, reply and raw
model text. Prettier reformatted both files after the run; the JSON content is
identical.

The run file and `../baselines/` are **as scored on 2026-10-11**: 85 passed.
Two adjudications dated 2026-10-12 (`order-status-in-transit`,
`order-status-verified`: the requirement became the carrier's tracking number
`SMSA1886204100`) change two verdicts. Re-scoring the recorded replies offline,
with no model call, gives 87 of 108 (80.6% after adjudication; 71.3% as
originally scored, unchanged); every other case's verdict is identical. That is
a re-score of one run, not a second measurement.

## 2026-10-12 re-scores of the 2026-10-11 run

Offline, no model call: `pnpm --filter @bitc/evals run rescore -- --run
packages/evals/history/2026-10-11-run.json [--cases-at <ref>]`. It takes the
recorded model text and the tool outputs persisted in the database, puts them
through the gate the loop calls (`gateReply`), and scores them with the runner's
own `scoreTurn`. It needs the database the run wrote to.

| File                                                                                       | Gate | Cases and adjudications     | Passed | As originally scored | After adjudication |
| ------------------------------------------------------------------------------------------ | ---- | --------------------------- | ------ | -------------------- | ------------------ |
| [2026-10-12-rescore-1-old-gate-run-cases.txt](2026-10-12-rescore-1-old-gate-run-cases.txt) | old  | as at `f9f35eb` (the run's) | 85     | 71.3%                | 78.7%              |
| [2026-10-12-rescore-2-old-gate.txt](2026-10-12-rescore-2-old-gate.txt)                     | old  | `755254a`                   | 87     | 71.3%                | 80.6%              |
| [2026-10-12-rescore-3-new-gate.txt](2026-10-12-rescore-3-new-gate.txt)                     | new  | `755254a`                   | 88     | 72.2%                | 81.5%              |

The first is the check on the re-scorer: against the old gate and the run's own
cases it reproduces every recorded field of all 108 outcomes. The second matches
the 87 recorded above. The third is the fragment rule and the offer exemption
(ADR 0005): one verdict changes, `returns-who-pays-pickup`, suppressed → answered,
fail → pass; nothing goes from pass to fail. Of the four replies the run
suppressed, that is the only one the new gate passes.

These are re-scores of one set of replies, not measurements. A model told less
often that its reply was withheld would not write differently here, because
nothing here asks it to write.

## What was lost

The runner writes one JSON file per run with every case's outcome, reply and
tool calls (`--out-json`). Those files were written to a temporary working
directory during the build, and that directory was cleared before this export.
**Per-case outcomes for every run are gone**, except the cases printed in the
files above and the replies quoted in `adjudications.json`.

From now on, write `--out-json` into this directory, and commit it with the
run:

```bash
pnpm evals run -- --suite en-core \
  --out packages/evals/history/<date>-run.md \
  --out-json packages/evals/history/<date>-run.json
```

The development key is free tier, and the suite's data is synthetic, so a run
file holds nothing that cannot be committed. Check that this is still true
before committing one made against real data.
