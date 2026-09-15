# Where this stands

Written at the Phase 2 → Phase 3 boundary, for someone who has to represent it
to a client. The organising question is not what works, it is **which claims
survive being challenged.**

---

## Proven

These are properties of the system, reproducible on demand, and they will
survive a client asking hard questions.

**Tenant isolation.** Row-level security with a non-BYPASSRLS application role,
two SECURITY DEFINER resolvers that return only a UUID, and a test that proves
a second tenant's rows are unreachable rather than merely unfetched. This is
the claim licensing depends on and it is the strongest one here.

**Unsourced fabrication is structurally impossible in model-composed prose.**
Every literal in a reply must trace to a retrieved chunk or a tool result, and
every sentence asserting one of nine policy concepts must cite a source
covering all of them. Zero fabricated literals across 103 cases in four
consecutive runs. Say it in exactly those words — the qualifiers are doing
real work, and the next section says why.

**The gate withholds rather than invents.** Every "fabricated literal" the
harness has ever reported — twelve across three runs — was the gate refusing a
correct answer, not the model inventing one. All twelve classes are fixed. A
failure here suppresses a reply and calls a human; it does not ship a wrong
one.

**Mutation testing is standard, and it keeps paying.** Three for three: row
security, the citation gate, and the storefront session token. Each time the
ordinary tests were green and a deliberately broken version of the code still
passed them. Every security- or correctness-critical component is
mutation-tested before its gate closes and the results go in the gate report.

**Order, price and stock facts never come from retrieval.** "Where is my
order" is a tool call. Architectural, and enforced by the case set.

**The build is honest about itself.** CI and the local verify command are
derived from the same list and a test fails if they diverge; a gate cannot
close over a red pipeline; a baseline cannot be recorded from an incomplete
run; an expectation cannot be reclassified without the evidence that forced it.
Most of these exist because the corresponding mistake was made first.

---

## Provisional

Measured, but not yet reliable enough to quote.

**Accuracy: 79.6% on 103 cases.** Two caveats, and both matter.

The suite is _drafted_, not client-validated — the cases were written from the
storefront by someone who does not work at 1886. And run-to-run variance is
**±3 to ±4.8 percentage points**, measured from cases whose sources did not
change between runs and whose verdicts flipped anyway. The honest form is
"about 80%, ±5, against expectations the merchant has not signed."

**Deflection 77.5%, escalation precision 73.8%.** Same variance, same caveat.

**The agent answered 56 of 103 questions and escalated 42.** Eleven of those
escalations are cases where the corpus genuinely has no answer. That ratio is a
property of this corpus, not of the product.

**Latency: 3.2s median, 8.1s at p95, 33s worst.** Slow for a chat widget. Not
yet optimised, and Phase 3 is where a customer first sees it.

---

## Unmeasurable at current precision

**Whether the system meets a 95% bar.** It cannot be determined. One complete
run a day on the free tier, ±4 points of noise, and a threshold that needs to
separate 95% from 91%. The bar is currently a number nobody can reproduce, and
`meetsShipBar` reports false with that caveat attached regardless of the score.
A repeat run at identical inputs is scheduled to pin the variance down, and
then the bar gets restated to whatever the measurement supports.

**Semantic policy accuracy.** Whether a cited claim is a faithful reading of
its source. Never automated, by design — an LLM judging a paraphrase is the
same class of system that produced it. It needs sampled human review, and none
has happened. This is the gap between "the citation resolves" and "the answer
is right", and it is not small.

**Whether the golden set resembles real customer questions.** Three of
twenty-one audited absence expectations were wrong, all in the same direction:
assuming the corpus says less than it does. Five out of five across the phase.
A systematic bias by an author who has not read the merchant's policies, and
not one the same author can fix.

---

## Claims that will not survive contact

The section worth reading twice.

**"It doesn't hallucinate."** Survives only in the narrow form above. Four
things it does not cover:

- **Merchant-authored copy is ungated, by decision.** Text a merchant types
  into the message fields reaches customers verbatim, never passing through the
  model, checked by nothing. That is deliberate and contractual, and it is in
  the licence clause — but it means the product does not guarantee what a
  client will assume it guarantees.
- **Tool results are laundered into confident answers.** The gate checks that a
  claim traces to a source; a tool result is a valid source. A wrong figure in
  tenant configuration reaches a customer having passed every check we have.
  Unsourced fabrication is impossible. Error is not.
- **Cross-source contradiction is structurally uncatchable**, and this is no
  longer hypothetical. 1886 publishes "free shipping is not applicable for
  international shipping" and, elsewhere, Kuwait as eligible for free shipping.
  The agent answered a customer from the second. Correctly grounded,
  contradicting a live page of the same store. Both documents are now the
  merchant's own exports, so no cleaner text fixes it.
- **A citation can resolve and still misread its source.** Attribution is not
  faithfulness. That is the sampled-review gap above.

**"It's 95% accurate."** Cannot be said at all. See above.

**"It answers most customer questions."** It answered 54% of a drafted set
against a corpus with known holes: no FAQ, and nothing published on payment
methods, opening hours, care instructions or sizing guidance. Those are ordinary
questions and the honest answer to each is a hand-over. The FAQ is the single
highest-value thing the merchant could provide.

**"It works in Arabic."** The Arabic system copy is placeholder text with no
native review. The retrieval path handles Arabic and the corpus is English.
Phase 5.

**"It's connected to the store."** It is not. Order lookup, product search and
stock checks run against synthetic fixtures and have never touched a real
Shopify store. Phase 4.

---

## The worst bug found in this build

Worth stating plainly, because a client will reasonably ask what was found and
when.

The storefront chat endpoint issues a conversation token; the browser stores it
and sends it back on the next turn. The first version issued sixteen random
bytes and checked the returned token's _shape_.

That is not safe, and it looks safe, which is the problem. **The client sends
the token back, so the client can send back anything.** A visitor posting
`token: "AAAAAAAAAAAAAAAAAAAAAA"` gets the conversation belonging to that
string — and so does everyone else who posts it. Two strangers would have
shared a transcript, and on this product a transcript holds **order numbers and
email addresses**, because the whole point is that customers ask where their
order is.

Checking the shape does nothing against this: a chosen token can be perfectly
well-shaped.

**Found by mutation testing, before anything real touched it.** Deleting the
shape check changed no test — correctly, because the shape check was never what
made it safe. A test suite that goes green when a security control is removed
is telling you the control was decorative.

Fixed by signing: tokens carry an HMAC the server verifies, so only a token
this server issued is adopted, and the signing key is derived from the
application encryption key rather than reused, so a session token and an
encrypted Shopify credential never share key material. Nine mutations now cover
the endpoint, including that one.

**No customer data has ever been through this code.** The endpoint has never
been deployed, the Shopify connection does not exist yet, and every order in
the fixtures is invented. The exposure was zero and the finding is still worth
having: it is the class of bug that ships quietly, and it was caught by a
discipline applied on purpose rather than by luck.

---

## What I would tell a client today

That the hard part is done and the easy-sounding part is not.

The grounding architecture works and is the thing worth buying: it will not
invent a return policy, and when it cannot answer it says so and fetches a
human. What has not been demonstrated is that it answers _enough_ questions
_well enough_, because measuring that needs a validated question set and more
measurement precision than a free-tier key affords.

Both are known, both are scheduled, and neither is a surprise waiting in the
code. The risk in this project is not that something breaks. It is that a
number gets quoted before it means anything — which has now nearly happened
three times, and the mechanisms that stopped it are the ones I would point at
if asked what the engineering is worth.
