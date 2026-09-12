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

**The citation gate cannot catch this.** Both chunks cover the same concepts —
shipping and timing — so whichever is cited, the citation resolves and is on
topic. Attribution is intact and the answer is still a coin flip. This is a
class of failure neither half of ADR 0005 addresses: _consistency across
sources_, as distinct from grounding in a source.

`shipping-processing-conflict` in the golden set exists to keep it visible until
it is fixed. It is not a case the agent can pass its way out of.

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
