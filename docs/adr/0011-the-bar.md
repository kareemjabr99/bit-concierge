# 0011 — The ship bar is a property, not a percentage

**Status:** accepted, supersedes the 95% accuracy threshold in ADR 0005
**Date:** 2026-09-16

## The bar

> **Zero fabricated literals reaching a customer.**
> **Zero uncited policy claims reaching a customer.**

Reported alongside, never as gates: **false suppression** — replies withheld
that should have been sent, currently about 5% — and the count of gate
interventions.

## The distinction that makes this honest

**A fabricated literal reaching a customer is a property. A count of gate
interventions is not.**

The first has no error bars. The gate inspects every reply and withholds any
that fails, so the number is zero by construction — and if it is ever above
zero the guarantee has been **broken, not degraded**. There is nothing to be
95% confident about, no threshold to tune, and no sample to reason about,
because it is not a sample. Every reply is checked.

The second counts claims the gate **caught**. Quoting it as a defect rate would
be quoting how often the safety net was used as though it were how often
someone fell. It also inherits the model's nondeterminism: across two runs at
byte-identical inputs it read 9 and then 8, with only three of eleven cases in
common. So it is reported and never thresholded.

False suppression is the cost the guarantee charges. It is reported for the
same reason a price is: because someone is paying it. It is not a gate, because
the only way to drive it down is to loosen the gate, and a bar that rewards
that is pointed the wrong way.

## This is a safety guarantee, not a quality guarantee

**Two separate claims. They must not blur.**

| claim                                                     | what proves it                                       | holds today |
| --------------------------------------------------------- | ---------------------------------------------------- | ----------- |
| The agent never states a fact it cannot trace to a source | the bar above                                        | **yes**     |
| The agent is worth paying for                             | deflection against a merchant-validated question set | **no**      |

The bar says nothing whatever about whether the answers are useful. A system
that escalated every single question would pass it perfectly and be worthless.
That is not a flaw in the bar — it is the reason the second row exists, and the
reason Phase 5 is client validation rather than more engineering.

Anything measured against the drafted suite — accuracy, deflection, escalation
precision — is a figure against expectations the merchant has not signed,
carrying a ±3.3 point interval from run-to-run nondeterminism. **None of it is
a bar and none of it should be quoted as one**, including after the metric fix
improves it. That stays true until Phase 5.

## Why the percentage went

95% accuracy was written down before anything had been measured. It was a
reasonable number to guess and it turned out to be the wrong instrument.

Two complete runs at byte-identical inputs found **12 of 103 cases
nondeterministic**. Fix every one of the 15 remaining deterministic failures —
perfect retrieval, perfect corpus, nothing left to improve — and those 12
remain: expected accuracy 94.2%, and a single run clears 95% **38.7% of the
time**.

A threshold that a perfect system fails six times in ten is not measuring the
product. More runs would have measured the wrong number more precisely. See
`docs/variance-measurement.md`.

And the variance was not what it looked like. All twelve flips were read rather
than counted, and **every one was between two behaviours that were both
correct** — handing over versus a safe refusal, answering versus the gate
withholding. Nothing leaked, nothing was invented. The suite was encoding one
acceptable answer where several exist.

## Consequences

**The bar can be met and reported without a model call.** It is a property of a
run, so any complete run on the production model against a validated suite
either has it or does not.

**It fails closed.** A provisional suite, a model mismatch, or any case that
never reached the model all fail it — because each makes the two properties
unverifiable rather than false.

**It is checkable rather than tautological.** Both figures count DELIVERED
replies. If the suppression branch were ever removed, they would go above zero
and the bar would fail, which is what a property check is for.

**The suite can now accept more than one behaviour per case**, which is what
the twelve flips were really asking for. That is also the move that turns a
metric into a formality, so it carries three enforced rules: widening needs the
replies quoted as evidence and happens one case at a time; a set may contain
only independently safe behaviours and never two factual answers; and the count
of multi-behaviour cases is in every report, permanently, so growth cannot be
quiet.

## What this does not cover

Everything ADR 0005 already says it does not cover, unchanged and worth
restating because the bar's plainness invites over-reading:

- **Merchant-authored copy is ungated by contract.** It never passes through
  the model, so the gate never sees it.
- **Tool results are laundered into confident answers.** The gate checks that a
  claim traces to a source; a tool result is a valid source. Unsourced
  fabrication is impossible. Error is not.
- **Cross-source contradiction is structurally uncatchable**, and 1886 has a
  live instance of it.
- **A citation can resolve and still misread its source.** Attribution is not
  faithfulness, and that gap is measured by sampled human review, which has not
  happened.
