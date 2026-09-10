# 0005 — The two halves of the hallucination bar

**Status:** accepted · both deterministic halves implemented in Phase 1
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

---

## Implementation notes (Phase 1)

Both deterministic halves are live in `packages/agent/src/guard/` and run on
every reply in `loop.ts`. The semantic half (sampled human review) arrives with
the eval harness in Phase 2.

### Marker contract

The prompt's SOURCES section requires `[[c:ID]]` after every policy sentence,
where ID is the `id` field of a `search_knowledge` result received _this
turn_. The gate accepts the marker on either side of the terminating
punctuation and folds it into the sentence before splitting, so the customer
sees neither the marker nor a stray space.

### What counts as a policy sentence

Sentences are split on `.` `!` `?` and the Arabic `؟` `۔`. A sentence is a
policy claim if it contains a term from a fixed English/Arabic lexicon —
returns, refunds, exchanges, shipping, delivery, warranty, sizing, care,
fees, duties, cancellation, discounts. Three exemptions:

1. **Questions** — a sentence ending in `?`/`؟` asserts nothing.
2. **Offers and pleasantries** — sentences opening with _I can_, _Let me_,
   _Would you_, _أقدر_, _خلني_ and the like state no policy even when they
   name one.
3. **Facts grounded elsewhere** — a sentence carrying a literal (order number,
   tracking reference, URL, long number) _or quoting a value_ (carrier name,
   product title, status, published range — six characters or more) that a
   _non-knowledge_ tool returned is reporting that tool, not stating a policy.
   The first real-model run withheld four correct answers before this rule
   existed: order facts spread across sentences, and the sentence with
   "shipped via SMSA Express" carried no literal of its own.
4. **A link to the source** — a sentence containing the URL of a retrieved
   chunk's page is attributed to that chunk, exactly as a marker would be. The
   first real-model run produced _"You can read the full policy details on
   our returns page (https://…/policies/returns)"_ after three correctly
   cited sentences and was withheld for it; the link is the attribution.

**Durations are always attributed.** "2–4 business days", "within 14 days",
"خلال 3 أيام" — a timing statement in any sentence is cited, quoted verbatim
from a tool result, or withheld, regardless of the exemptions above. This is
the gate's enforcement of the prompt's no-timing-commitment rule.

Everything else that reads as a policy claim must carry a marker that resolves
to a chunk retrieved this turn. `no_marker`, `unknown_chunk` and
`no_retrieval` are the three miss reasons, recorded on `messages.grounding`.

### Known precision limits

The lexicon is deliberately over-inclusive. A conversational sentence that
mentions shipping without stating a rule can be flagged; when it is, the reply
is withheld and escalated — the safe direction. Two consequences:

- A rising suppression rate is a signal to tune the lexicon or the prompt,
  and is worth alerting on. It is visible per turn in the CLI's `--debug`
  output and per message on `messages.grounding`.
- Phase 2's eval harness measures the false-suppression rate directly. That
  number, not intuition, decides what leaves the lexicon.

The order-fact exemption relies on the model including a literal in the
sentence. _"Your order has shipped"_ with no order number is flagged; the
prompt asks for the number, and the fixture transcripts show the model
supplying it.
