# 0005 — The two halves of the hallucination bar

**Status:** accepted, Phase 0 (design) · implemented Phase 1–2
**Date:** 2026-09-10

## Context

The ship bar is **zero fabricated order or policy facts**, treated as pass/fail
rather than a percentage to improve later. A single hallucinated policy in front
of the client kills the sale.

A prompt rule gives you "usually". An LLM judge gives you "usually, and the
judge hallucinates too". Neither makes zero a property of the system.

## Decision

Two mechanisms, deliberately kept apart, because they give different kinds of
guarantee. **This distinction must not blur in reporting.** A single blended
"hallucination score" would hide which part of the bar is guaranteed and which
part is sampled, and that is the number a client would be shown.

---

## Half one — deterministic. A property of the system.

Runs on every reply, before it reaches the customer. No model involved.

### Literal check

Extract the fact classes that can hurt us and assert each appears verbatim in
that turn's tool results:

- order numbers
- tracking numbers
- URLs of any kind, tracking and product links included
- prices and currency amounts
- dates and delivery windows
- stock and availability claims

A miss suppresses the reply, records the verdict on `messages.grounding`, and
escalates.

This also contains prompt injection: a poisoned document that talks the model
into inventing a refund link cannot produce a URL the tools never returned.

### Citation check

The literal check has a hole, and it is the one that matters most commercially.
_"You can return within 14 days"_ contains no literal to match. If the retrieved
chunk says three days, the reply passes.

So: **every policy assertion must carry the id of the retrieved chunk it came
from.** The model emits an inline marker after each policy claim; the marker is
resolved against the chunks `search_knowledge` actually returned this turn and
stripped before display. A policy claim with no resolvable chunk id is
suppressed and escalated, exactly like a literal miss.

Two nets, because a turn where retrieval was never called still needs covering:

1. If `search_knowledge` ran, every declarative sentence not grounded in another
   tool's result must carry a resolvable marker.
2. A policy-lexicon trigger list (return, refund, exchange, ship, deliver,
   warranty, size, care, days, free) catches policy claims on turns where
   retrieval was never called at all. A policy claim with no retrieval is an
   automatic suppress.

### What this half guarantees

That a fact in a reply came from somewhere real. Measured as
`eval_runs.hallucination_count` and `eval_runs.citation_miss_count`. **Target
zero, and it is enforced at runtime, not just measured.**

---

## Half two — measured. Not a property of the system.

The citation check proves a claim is _attributed_. It cannot prove the claim is
a _faithful_ reading of what the chunk says. A reply citing a chunk that says
three days while asserting fourteen passes every deterministic check.

Scoring that automatically is not credible. An LLM judging whether a paraphrase
is faithful is the same class of system that produced the paraphrase.

So semantic policy accuracy is **its own eval category**, scored on a sampled
subset flagged for human review each run, and reported separately from the
deterministic metrics.

Recorded as `eval_runs.policy_accuracy_sampled`, `policy_sample_size`,
`policy_sample_reviewed_by`, `policy_sample_reviewed_at`. A run with no reviewer
has **no semantic score at all** — not a default, not a zero, not an estimate.

### What this half does not guarantee

Anything, on its own. It is a sampled estimate of paraphrase fidelity with a
human in the loop. Treat it as a quality signal that trends, never as a gate
that passes.

---

## How to report this

> Deterministic: 0 fabricated literals, 0 uncited policy claims, across 100
> cases. Enforced at runtime.
>
> Sampled: 24 of 24 policy paraphrases judged faithful by <reviewer>, from a
> 24-case sample. Estimate, not a guarantee.

Never one number. Never "99.6% accurate".

## Consequences

- Every reply carries latency for the deterministic gate. Single-digit
  milliseconds, no tokens.
- The model must be prompted to emit citation markers, and the prompt template
  owns that instruction — it is not optional per tenant.
- Suppressed replies are a visible metric. A rising suppression rate means the
  prompt or retrieval degraded, and is worth alerting on.
- False positives are possible: a legitimate reply suppressed because a price
  was reformatted. Normalise before comparing (currency symbols, digit forms —
  Arabic-Indic included, thousands separators) and treat a false suppression as
  a bug in the gate, not a reason to weaken it.
