# Corpus findings — 1886riyadh.com

What the public storefront actually contains, found while building the Phase 2
index. Some of these are ours to work around; two are the merchant's to fix and
should go back to them.

Verified 2026-09-12 against 37 ingested documents / 121 chunks.

---

## For the merchant

### The same policy is published twice, with different numbers

| page                        | processing time                                |
| --------------------------- | ---------------------------------------------- |
| `/pages/shipping-policy`    | orders processed within **1–10 business days** |
| `/policies/shipping-policy` | orders processed within **2–3 business days**  |

Both pages are live. A customer reading one gets a different answer from a
customer reading the other, and so does the assistant: retrieval returns
whichever chunk scores higher for the phrasing used.

**The citation gate is structurally incapable of catching this.** It reasons
about one claim against one source and has no concept of agreement _between_
sources. This belongs to the same class as the tool-provenance limit — both are
cases where a claim is perfectly grounded and still wrong — and both are
recorded together in [ADR 0005](adr/0005-grounding.md#what-the-gate-does-not-do).

Originally: Both chunks cover the same concepts —
shipping and timing — so whichever is cited, the citation resolves and is on
topic. Attribution is intact and the answer is still a coin flip. This is a
class of failure neither half of ADR 0005 addresses: _consistency across
sources_, as distinct from grounding in a source.

`shipping-processing-conflict` in the golden set exists to keep it visible until
it is fixed. It is not a case the agent can pass its way out of.

### Three more contradictions between the two shipping pages (found 2026-09-14)

The processing-time conflict above is not the only one. `/policies/shipping-policy`
and `/pages/shipping-policy` are near-identical pages that disagree on three
customer-facing facts:

| fact                      | `/policies/shipping-policy`   | `/pages/shipping-policy`  |
| ------------------------- | ----------------------------- | ------------------------- |
| Tracking number activates | within **24 hours**           | within **72 hours**       |
| Express delivery          | **1 to 3 days**, 0 SR per 5kg | (table differs)           |
| DHL Express Worldwide     | **4 to 7 days**               | **5 to 10 business days** |

And across the shipping policy and the terms of service:

| fact                          | `/policies/shipping-policy`                                      | `/policies/terms-of-service`                                                                             |
| ----------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Free shipping internationally | "Free shipping is **not applicable** for international shipping" | Free Shipping Promotion eligible in Saudi Arabia, UAE, Bahrain, Kuwait, Oman — regular-priced items only |

That last pair is the sharpest, because the agent answered a customer question
from it. Asked "do you deliver to Kuwait?", it replied that Kuwait is eligible
for the free shipping promotion, citing the terms of service. The answer is
correctly grounded and it contradicts a different live page of the same store.

**This is the structural limit, demonstrated rather than argued.** The citation
gate checks that a claim traces to a source. It has no view of whether another
source says the opposite, and it cannot acquire one — a gate that reasoned
about agreement between sources would be making an editorial judgement about
the merchant's content, which is not ours to make.

These are the merchant's to resolve. Ours is to keep them visible: every
contradiction here is a question a customer can ask and get two different
correct answers to, depending on which page retrieval happens to surface.

### The same policy is published twice, identically

`/policies/refund-policy` and `/pages/returns-policy` are near-duplicates, as
are the two shipping pages. Handled on our side — the crawler skips a document
whose content fingerprint it has already seen, and retrieval collapses
near-identical chunks so they cannot fill the top-k between them — but it is
duplicated content on a live store, and deduplication by fingerprint stops
working the moment someone edits one copy.

---

## Corpus gaps — content we cannot reach

These pages exist and are linked, but their content is rendered client-side, so
an HTTP crawl retrieves a heading and nothing else. **Flagged rather than worked
around**, because these are exactly where customer questions live.

| page                                | what is missing                                                        |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `/pages/faq-1`                      | the FAQ itself — questions are visible only inside a section JSON blob |
| `/pages/return-exchange`            | the online returns portal                                              |
| `/pages/stores`                     | the branch locator; the page extracts to "Loading store locator…"      |
| `/pages/order-tracking-form`        | the tracking form                                                      |
| several `/pages/<garment>-<season>` | size charts for specific garments                                      |

The ingestion script refuses to index a page whose content is a heading and
nothing else. Indexing one would be worse than skipping it: it would match the
query and answer nothing.

**CORRECTED 2026-09-12.** An earlier version of this document claimed store
addresses were unreachable. They are not — `/policies/contact-information`
carries the registered address, phone number and care email:

> Trade name: 1886 fashion · Phone: 920021886 · Email: Care@1886fashion.com ·
> Physical address: 1886 fashion, Al-Marwa, Al-Fursan st, Riyadh 14722, Saudi Arabia

Only the _branch locator_ is unreachable. The golden-set case that asserted
otherwise was wrong, the agent answered it correctly and cited the right
document, and I scored it a failure — the second of 102 drafted cases to be
wrong in exactly that direction.

Consequences still visible in the golden set: `unanswerable-opening-hours` and
`shipping-track-how` expect an escalation because the content is unreachable,
not because the store has no answer.

**CORRECTED 2026-09-14.** The claim above that `shipping-track-how` has no
answer in the corpus was also wrong. `/policies/shipping-policy` and
`/pages/shipping-policy` both publish a "Shipment confirmation & Order
tracking" section describing the Shipment Confirmation email and its tracking
number. Retrieval scored those chunks 0.5 and the threshold excluded them, and
that retrieval failure was written down here as a fact about the corpus. It
then became the cited evidence for reclassifying the case — which is how a
measurement of the retrieval stack ends up recorded as a property of the
merchant's content. See `docs/adr/0005-grounding.md`; the adjudication schema
now requires a direct text search, because a substring search does not care
what the reranker thought.

**What would close them:** plain-text exports, dropped in `corpus/1886/clean/`.
The four policy documents are already offered; the FAQ is the one that matters
most and is not available.

---

## Topics genuinely absent from the published corpus

Checked directly, not assumed. An assistant that answers any of these is
fabricating:

- **Payment methods.** Every "payment method" match in the corpus is "the same
  payment method used for your purchase", about refunds. No list of accepted
  methods, no Tabby, no Tamara, no mada.
- **Care and laundry instructions.** No wash, iron or fabric-care guidance
  anywhere.
- **A tracking activation window.** The seed question set asserted tracking
  becomes active within 72 hours. Not in the corpus.
- **Refund settlement time.** The corpus gives the return transit time (up to 15
  business days) and the approval step, but no bank-settlement figure.
- **Fit guidance.** Measurement charts exist; "runs large", "true to size" and
  equivalent advice do not.

---

## What the corpus does say, precisely

The facts the golden set is written against. Quoted rather than paraphrased,
because a paraphrase is how the first set of fixtures went wrong.

**Returns and exchanges.** Eligible within **7 days** — in-store from the _date
of purchase_, online from the _date of order delivery_. Items must be unused,
unworn, with original tags and labels attached. Proof of purchase required for
all returns. **Returns do not apply to Archive Collection items or any
discounted/sale items.**

**Starting a return.** Online: email `care@1886fashion.com` within 7 days of
delivery; a pickup is arranged **with an additional shipping fee depending on
location**; it may take up to 15 business days for the return to reach them.
In-store: visit the nearest branch within 7 days of purchase. Refund is issued
via the same payment method after a quality-department check. **Shipping fees
for online orders are non-refundable.**

**Exchanges.** Online or in-store, subject to stock availability and quality
inspection; the customer either pays the price difference or receives a partial
refund.

**Shipping.** Not shipped or delivered on weekends or holidays. Express delivery
KSA 1–7 business days; DHL Express Worldwide 5–10 business days. Charges
calculated at checkout and varying by destination. The store reserves the right
to cancel any order without prior notice, refunding in full. Not liable for
products damaged or lost in transit — the customer files a claim with the
carrier and keeps the packaging.

**Two separate non-refundable charges** sit on the returns path: the pickup fee,
and the original shipping fee. An answer that mentions one and not the other
understates what a return costs.

---

## After the merchant exports (2026-09-14)

Four plain-text policy exports landed in `corpus/1886/clean/` and were ingested
in place of the crawled renderings of the same policies. 37 documents and 121
chunks became 35 and 91: the store's second copy of each exported policy —
`/pages/shipping-policy`, `/pages/returns-policy`, `/pages/terms-condition` —
is no longer indexed, because a second rendering of one policy is not extra
coverage, it is a coin toss about which figure a customer is told.

### What the exports resolved

| conflict              | before                    | now                                             |
| --------------------- | ------------------------- | ----------------------------------------------- |
| Order processing time | 1–10 business days vs 2–3 | **1–10**, one chunk, from the merchant's export |
| Tracking activation   | 24 hours vs 72            | **72 hours**, one chunk                         |
| DHL delivery estimate | 4–7 days vs 5–10          | **5–10 business days**                          |

The merchant has taken a side rather than reconciled the pages: both figures
are still live on the storefront and that is being raised with them separately.
What changed here is that the agent now says one thing instead of whichever
thing retrieval surfaced.

### What the exports did not resolve

**Free shipping.** `/policies/shipping-policy` says "Free shipping is not
applicable for international shipping." `/policies/terms-of-service` lists
"Countries Eligible for Free Shipping Promotion: Saudi Arabia, UAE, Bahrain,
Kuwait, Oman." Both are now merchant exports, so this is not a crawl artefact
and no cleaner text will fix it. The agent has already answered a customer from
the second — correctly grounded, contradicting the first.

**Payment methods are absent.** Confirmed by substring search: `"we accept"`
returns zero chunks, and every `"payment method"` hit is "the same payment
method used for your purchase", about refunds. This is the topic that produced
the only fabricated answer in the partial-class A/B — an on-topic terms clause
about order-cancellation limits, written up as an accepted-payments list.

### A citation now points at a page whose text may differ

Preferring an export means the indexed text is the merchant's document while
the cited URL is the merchant's live page, and on the shipping policy those two
already disagree. The precedence rule is the right one and this is its cost:
until the merchant reconciles the pages, a customer who follows a citation may
read a different number from the one they were told. Worth stating because it
is a new way for a correctly-gated answer to be wrong.

### Absence-claim audit

Twenty-one golden-set cases assert something is not in the corpus. Every claim
was re-checked by substring search against the indexed text. **Three were
wrong, all in the same direction, all about shipping:**

| case                             | claimed                                   | actually                           |
| -------------------------------- | ----------------------------------------- | ---------------------------------- |
| `shipping-track-how`             | no tracking instructions                  | published, on two pages            |
| `shipping-tracking-not-updating` | 72-hour window "verified absent"          | published in the shipping policy   |
| `shipping-gcc`                   | "the corpus does not enumerate countries" | five are listed, Kuwait among them |

All three would have scored a correctly grounded answer as a fabrication. The
remaining eighteen hold — gift wrapping, price match, BNPL, opening hours,
careers, restock dates and care instructions all return zero chunks.

One is worth keeping visible: `care-wash` is correctly absent —
`"laundr"`, `"dry clean"` and `"care instructions"` return nothing — but
`"wash"` returns six chunks, every one of them product copy describing a
colour: "washed sapphire blue", "machine-washable masks". A retrieval hit there
is not an answer, and it is the shape that produced the payment-methods
fabrication.
