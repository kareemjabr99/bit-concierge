# Would an ingest-time canary catch an embedding ordering break?

**Yes — but only one design does, and it is not the obvious one.**

## The failure being guarded against

`embedDocuments(['A', 'B', 'C'])` returns three vectors and the caller zips
them back onto rows by index. If the provider returns them in the wrong order,
every chunk is stored against someone else's vector.

Retrieval then returns confidently wrong passages, and **the citation gate
passes them**, because the chunk id resolves to a real document. The answer
would be grounded, cited, and about a different policy. There is no other check
in the system that would notice.

The AI SDK verifies the _count_. Nothing verifies the _order_, and nothing can
from the outside: an embedding carries no identifying information, so a
returned vector cannot be checked against the text it is supposed to describe.

## The obvious canary does not work

> Embed a known text, then assert its nearest neighbour in the index is itself.

This fails for a simple reason: the canary is embedded in **its own call**, a
batch of one, and a batch of one cannot be misordered. The canary's vector is
correct by construction while every real batch is scrambled. It would pass
every time and prove nothing.

The same objection applies to any check that embeds the canary separately from
the content it is meant to vouch for. **Ordering is a property of a batch, so
the probe has to be inside the batch.**

## The design that works

**Put the same canary text in the batch three times — at index 0, index 1, and
last — and assert all three returned vectors match.**

```
batch:    [ CANARY, CANARY, chunk1, …, chunkN, CANARY ]
assert:   cosine(v0, v1) ≈ 1  AND  cosine(v0, vlast) ≈ 1
```

**The placement is asymmetric on purpose, and the first design got this
wrong.** One canary at each end looks natural and is defeated by a _reversal_:
the two ends map onto each other, both still hold a canary vector, the check
agrees, and every chunk between them is silently transposed. That was found by
writing a test for reversal rather than by reasoning about it.

Probes at 0 and 1 cannot survive a reversal or a rotation together. The one at
the end covers a corruption confined to the tail, which probes at the front
would never see.

Identical text embeds to an identical vector, so under correct ordering the two
positions agree. Under any reordering that moves either position, they hold two
different chunks' vectors and disagree — and the disagreement is enormous,
because unrelated passages are nowhere near each other in the space.

Why this is the right shape:

- **No stored reference vector.** A golden vector would have to be regenerated
  for every model and every dimensionality, and would go stale silently. This
  compares the batch against itself.
- **No assumption about determinism across calls**, only within one. Both
  canaries are in the same request.
- **Catches the systemic breaks**: rotation, reversal, off-by-one, and a
  dropped element shifting the tail.

## What it does not catch

Stated plainly, because a canary that is believed to prove more than it does is
worse than none.

- **A permutation that maps all three canary positions onto each other.** With
  probes at 0, 1 and last this requires a permutation constructed against this
  specific check — an adversarial case, not a systemic failure mode.
- **A provider that reorders consistently by content**, such that identical
  texts still land together. Contrived, and not a shape any real client library
  produces.
- **Anything about a single-value `embedQuery`.** One value has no order.

It detects _that_ ordering broke, never _what_ the correct mapping was. The
response is to fail the ingest, not to repair it.

## The threshold has to be near 1, not merely high

Identical text must give an identical vector, so the comparison is against
**0.9999** — low enough only to tolerate floating-point drift through
normalisation.

A "high" threshold like 0.9 would be useless, and this corpus shows why: the
two shipping policies are near-duplicates. Transposing two related passages
produces vectors around 0.9 apart and an answer that is entirely wrong to
serve. A loose threshold would wave through exactly the confusion that matters.

## Cost

Three extra texts per batch. At the current batch size that is roughly 3%
overhead on an operation that costs **under one cent for the entire corpus**.
Query embeddings are unaffected — the canary is ingest-time only.

## Recommendation

**Built, 2026-09-20.** It is cheap, it closes the one limit in the retrieval path that
nothing else could catch, and the failure it guards against is the worst
available: contamination that looks exactly like correct grounding.

It does not replace the provider contract. It detects a systemic break in that
contract at the moment it would otherwise become invisible.
