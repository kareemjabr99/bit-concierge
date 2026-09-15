# 0010 — The reply does not stream, and the wait is designed instead

**Status:** accepted, Phase 3
**Date:** 2026-09-14

## Context

Every competitor types word by word. A client who has watched one will ask why
this does not, and "architecture" is not an answer anyone buys. So this is
written to be read by someone selling it, not only by someone maintaining it.

The deterministic grounding gate runs on the finished reply. It has two halves
and both need the whole text:

- **The literal check** compares every number, date, price, duration and URL in
  the reply against what retrieval and the tools actually returned. A figure
  that appears in the third sentence is checked against sources gathered for
  the first.
- **The citation check** requires that a sentence asserting a policy concept
  cites a source covering every concept it asserts. A sentence's support can be
  established by a marker in a later sentence, so the check cannot run
  left-to-right.

The gate's verdict is not advisory. It can be **withhold this reply and fetch a
human**, and on the last full run it did so five times out of 103.

## Decision

**No token streaming of the answer. The reply is delivered whole, after the
gate clears it.**

A stream cannot be un-sent. Streaming would mean one of three things, and all
three are worse than a wait:

1. **Show text the gate has not cleared**, then retract it. The customer has
   already read the wrong return window. Retraction is not a fix; it is the
   damage plus an apology.
2. **Clear sentence by sentence.** The concept check cannot do this — support
   can arrive later in the reply — so this is not a stricter version of the
   gate, it is a different and weaker one.
3. **Stream, and drop the withhold verdict.** This is the honest version of
   what streaming costs, and it is the one to say out loud: the product's
   single distinguishing guarantee, traded for a typing animation.

## The commercial case

The thing being sold is not a chat box. Chat boxes are free. What is being
sold is **a store assistant that cannot invent your return policy**, and the
gate is the whole of that claim.

Put to a merchant, the trade is:

> Would you rather a customer see words appear instantly, or never see this
> assistant tell them something about your store that is not true?

Every wrong answer a storefront assistant gives is a support ticket, and some
of them are a refund the merchant did not agree to. 1886's return window is
seven days; an assistant that says thirty has created an obligation the store
will either honour or refuse in front of a customer who was told otherwise.
A typing animation does not offset that once.

Two things make this an easier conversation than it sounds:

- **A competitor that streams is telling you it does not check.** Word-by-word
  output is evidence that nothing inspects the finished answer, because nothing
  can. That is worth saying plainly, and it reframes the feature as a
  disclosure rather than a polish gap.
- **Most of the wait is real work, and work can be shown.** The agent is
  searching the store's policies, reading an order, checking stock. A customer
  who is told "checking your order" waits differently from one watching a
  spinner. Streaming hides latency; showing the tool loop explains it.

## Consequences

**The wait is a first-class design problem, not a spinner.** Measured on the
last full run: 3.2s median, 8.1s at p95, 33s worst. Eight seconds of nothing
reads as broken. The widget therefore surfaces **stages from the real tool
loop** — the tool the agent actually called, as it calls it — and never
invented progress. A fake stage is a small lie told by a product whose entire
pitch is that it does not tell them.

**Perceived latency is now an engineering target.** p95 of 8.1s is the number
to attack, and the ways in are real: the reranker costs one model call per
search, retrieval and the first generation could overlap, and a paid key
removes the pacing that the free tier's 15-requests-a-minute imposes. None of
those require touching the gate.

**This decision does not get revisited under UX pressure.** It is settled, and
the reason is written here so that the argument does not have to be
reconstructed by someone looking at a competitor's demo. If a reply can be
withheld, it cannot stream. What could change is the gate — a different
grounding design might permit incremental verification — and that is an ADR
about the gate, not about streaming.

## What was rejected

**Streaming with a retraction.** See above: retraction is the damage plus an
apology.

**Streaming a "draft" watermarked as unverified.** Asks the customer to hold
two states in mind and to notice when one is replaced. Customers screenshot
drafts.

**Streaming only for turns the gate is unlikely to withhold.** Requires
predicting the verdict before producing the text, which is the thing the gate
exists to do. A predictor good enough to gate on is the gate.
