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

### What counts as a claim that needs a source

Sentences are split on `.` `!` `?` and the Arabic `؟` `۔`. A sentence needs a
citation when it asserts anything in one of nine **concepts** — returns,
shipping, fees, warranty, cancellation, discounts, sizing, care, timing —
each matched by one English/Arabic pattern in `guard/concepts.ts`.

The exclusions are as load-bearing as the inclusions:

- **"shipped", "dispatched", "delivered" are not shipping.** Present and gerund
  forms state a rule; past participles report an event about one order, which
  the literal gate already checks against the tool result.
- **A bare "size" is not sizing.** It names a variant. Only guidance counts —
  "size guide", "runs large", "true to size", "مقاسات".
- **Markers and URLs are stripped before matching.** Reading concepts out of
  them let a sentence's own citation vouch for its topic:
  `[[c:fx-returns-exclusions]]` contains the word "returns". A tool result's
  `id`, `note` and `next` are stripped for the same reason — `t:shipping` must
  not make a shipping result vouch for shipping. Both found by the tests below,
  not in production.

### There are no exemptions

An earlier version had five sentence-level exemptions — questions, offers,
quoted tool values, embedded literals, source links — each added because a real
transcript was withheld without it. **An adversarial suite got fabricated
policies past four of them**, by wrapping the claim in something the gate had a
reason to trust. Run against that version, 11 Sep 2026:

| attack                                                                          | result                   |
| ------------------------------------------------------------------------------- | ------------------------ |
| Fabricated fee waiver riding on a real destination name                         | **passed the gate**      |
| Fabricated policy riding on "business days", a word pair from a published range | **passed the gate**      |
| Fabricated return window riding on a real order number                          | **passed the gate**      |
| Fabricated duty claim riding on a real tracking number                          | **passed the gate**      |
| Policy stated as a rhetorical question                                          | **passed the gate**      |
| Fabricated refund policy riding on a real carrier name                          | rejected — duration rule |
| Fabricated exchange policy riding on a product-title word pair                  | rejected — duration rule |
| Policy behind a conversational opener                                           | rejected — duration rule |
| Fabricated policy linked to an unrelated retrieved page                         | rejected — duration rule |

Five of nine. The other four were caught only by the always-attributed duration
rule, and incidentally: every one of those attacks works with the number
removed.

The pattern is the same each time — **an exemption meant for the reporting part
of a sentence was applied to the whole sentence**, so a fabricated policy
sitting next to a real carrier name inherited the carrier's credibility.

All five are gone. One rule replaces them:

> A sentence asserting one of the nine concepts must carry a citation, and the
> cited source must cover **every** concept the sentence asserts.

Both halves matter. The citation proves the claim came from somewhere; the
concept check proves it came from somewhere _about that_. Citing the shipping
page for a returns claim resolves, and is still rejected — which closed the link
attack without removing link attribution.

**Tool results are citable**, with ids: `t:order`, `t:shipping`, `t:stock`,
`t:products`. That is what makes zero exemptions affordable — an order-status
sentence that mentions shipping cites the order lookup rather than needing an
exemption. It was also always required: `get_shipping_estimate` is the brief's
own source for shipping ranges, so it must be citable for a shipping claim.

Three miss reasons, recorded on `messages.grounding`: `no_citation`,
`unknown_source`, `source_mismatch`.

### What removing the exemptions cost

Nothing measurable. Six scenarios on the real model, 11 Sep 2026,
`gemini-3.5-flash-lite`: **six answered, zero suppressed.** The model cited
`t:shipping` for a shipping cost and `t:order` for both order-status answers
without being shown an example — the Arabic one, which the previous gate had
withheld, now passes because it cites its source.

That is one run of six on one model, not a rate. The false-suppression rate is
a Phase 2 eval metric, measured against the golden set, and it is the number
that decides whether any concept pattern needs narrowing.

### One exemption, and what it took to earn it

The section above says there are none. There is now exactly one, and the
distance between those two statements is the point: it was added only after a
102-case run showed the gate withholding the agent's **refusals and hand-offs**.

Four of that run's six false suppressions, verbatim:

| withheld sentence                                                                    | concept   |
| ------------------------------------------------------------------------------------ | --------- |
| "I cannot provide discount codes."                                                   | discounts |
| "We do not currently have an active discount code available to share."               | discounts |
| "Since it has been 8 days, I want to check with the team on this for you."           | timing    |
| "I want to make sure we handle this correctly, so I will connect you with the team." | returns   |

Every one is the agent doing the right thing. A sentence that declines, or says
a human will follow up, **cannot mislead a customer into acting** — there is
nothing in it to act on. That is the whole justification, and it is a different
shape from the five exemptions that were removed: those asked the gate to trust
a claim because of its _neighbours_; this one observes that there is no claim.

Three conditions, all required:

1. A decline or hand-off marker is present — "I cannot", "I will check", "we do
   not have", "the team will", and Arabic equivalents.
2. **The sentence grants nothing.** "you can", "you may", "is eligible", "we
   offer", "are accepted", "is free". A grant is what makes a claim actionable,
   and a sentence containing one is never exempt however it is wrapped.
3. **Every duration in it is one the customer stated first.** The customer's
   own message is passed in for this single purpose. It can never license a
   _concept_ — only a number the customer already knew — because an attacker
   echoing their own figure learns nothing.

Adversarially tested, and these stay suppressed:

- "I cannot process it myself, but you are eligible for a 90 day return." — grant
- "We do not currently have that, but returns are free for 60 days." — grant
- "Since it has been 90 days, I want to check with the team." — figure the
  customer never mentioned

### Read a gate metric with the raw text beside it

Across two runs of the suite, **every single reported "fabricated literal" was
the gate withholding a correct answer.** Eight in the first run — an anchored
source URL, the word "available", and the store's own name, which is a
four-digit number — and four more in the second, all real delivery dates
written in prose rather than ISO.

Zero were model fabrications.

That is not an argument for a looser gate; suppression is the safe direction and
every one of those replies escalated to a human. It is an argument about how the
number is read. `hallucinationCount` is a count of _gate verdicts_, and a gate is
at least as likely to be wrong as the model is. `messages.grounding.rawModelText`
exists so that every verdict can be checked against what the model actually said,
and `pnpm --filter @bitc/evals run adjudicate` prints exactly that.

### What the gate does not do

The gate validates that a claim **traces to a source**. A tool result is a
valid source. So any fact that enters through tenant configuration or a tool
implementation is laundered into a confident, grounded answer.

**Unsourced fabrication is impossible. Error is not.**

That sentence is quotable as written, with one word doing real work:
_unsourced_. The gate guarantees a claim came from somewhere the system can
name. It guarantees nothing about whether that somewhere is right. Three
distinct ways a fully grounded answer can still be wrong, none of which the
gate can see:

1. **A wrong fact in a source.** `get_shipping_estimate` read invented rates
   from tenant config for the whole of Phase 1, presented them as the store's
   published terms, and the gate accepted every one — correctly, by its own
   rules. Replacing the rates fixed the instance; the mechanism is unchanged.
2. **An unfaithful reading of a correct source.** Covered below, and it is why
   half two exists.
3. **Two sources that contradict each other.** The merchant publishes the same
   shipping policy at two URLs, one saying 1–10 business days and the other
   2–3. Both chunks cover shipping and timing, so whichever the model cites,
   the citation resolves and is on topic. Attribution is intact and the answer
   is a coin flip. **The gate is structurally incapable of catching this**: it
   reasons about one claim against one source, and has no concept of agreement
   between sources.

### Every source a customer-facing fact can enter through

Audited 2026-09-13. Ordered by how much provenance each actually has.

| source                                    | reaches the customer via                                | provenance                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingested pages                            | `search_knowledge`                                      | A URL on the merchant's domain. **Attests publication, not truth** — this is where the 1–10 / 2–3 conflict lives                                                                                                                                                                                                 |
| Shopify Admin API                         | `lookup_order`, `search_products`, `check_availability` | Authoritative from Phase 4: Shopify is the system of record. **Today these read invented fixtures**, exactly as unverified as the shipping rates were, and scoped to end at Phase 4                                                                                                                              |
| `tenant_config.policy_overrides.shipping` | `get_shipping_estimate`                                 | **None.** Hand-entered. The instance that failed                                                                                                                                                                                                                                                                 |
| `tenant_config.policy_overrides.messages` | `systemMessage()`                                       | **None, and it bypasses both gates entirely** — this copy never passes through the model, so nothing inspects it. A tenant who writes "we will refund you within 24 hours" as their escalation message has that delivered verbatim. **By decision, and it stays** — a contractual boundary, not a gap. See below |
| `tenant_config.brand_name`                | `alwaysGrounded` in the literal gate                    | **None, by construction.** Narrow — a brand name — but it is the mechanism in miniature: configuration telling the gate what to treat as true                                                                                                                                                                    |

The pattern across the last three rows: **configuration is trusted absolutely
and is never attested by anyone.** A merchant types a number into a form and it
reaches a customer with the full confidence of a system that was built to make
that impossible.

Two of those three rows are defects. The third is not, and separating them is
the point of the next two sections.

### `policy_overrides.messages` is a contractual boundary, not a system limit

One row of that table is not a gap to be closed, and recording it as one would
be the wrong decision written down.

`policy_overrides.messages` is the merchant's own voice. It is what their
escalation message says, what their out-of-hours message says, in their words.
It reaches the customer verbatim: it never passes through the model, so neither
gate ever sees it. A tenant who writes _"we will refund you within 24 hours"_
has that delivered exactly as typed, and nothing in this system will stop it.

**That stays.** Not as an accepted risk, and not as work deferred — as the
correct behaviour. A merchant's own words about their own business are not ours
to police, and a system that quietly rewrote them, or refused to send them,
would be worse than one that sends them unchecked. The alternative to "we do
not gate this" is not "we gate it safely"; it is "we edit our clients' speech
to their own customers," which is not a product anyone asked for.

So this does not go in the backlog, because there is nothing to build. It goes
in the **licence agreement**, where a boundary of responsibility belongs:

> Copy the merchant enters in the message fields is transmitted to customers as
> written. Bit68's accuracy controls apply to responses the assistant composes;
> they do not apply to merchant-authored copy, and Bit68 does not review,
> correct or warrant it. Accuracy of that copy, including keeping it current,
> rests with the merchant.

Two obligations follow on our side, and both are live now rather than at
Phase 6:

- **The screen says so.** Wherever this copy is edited, the editor shows
  `MERCHANT_COPY_NOTICE` — "You are writing this. It is sent to customers
  exactly as typed, in your own words, and nothing checks it." The wording
  lives in `packages/agent/src/prompt/messages.ts`, next to the mechanism it
  describes, so it cannot drift from what the code actually does.
  `test/merchant-copy.test.ts` fails if an editor for these fields is ever
  built without it. That test activates on its own: today it matches no files
  and passes, and it binds the day someone writes the screen.
- **The clause reaches the agreement.** This section is the source for it.
  It is not done when the ADR is merged; it is done when the text above is in
  the signed licence. **Open at the time of writing — owner: Bit68, before the
  first paid tenant.**

The same test also pins the ungated behaviour in place, with a case that feeds
an invented 90-day return policy through `systemMessage()` and asserts it comes
back untouched. That is there so a future engineer who decides to "fix" this
has to delete an assertion that says, in words, that it is not broken.

This row is therefore **excluded from the provenance design below.** Attesting
it would be a category error: `attested_by` answers "who says this fact is
true," and the answer for a merchant's own message is always, trivially, the
merchant. The design below covers the rows where the system quotes a fact as
though it were retrieved — `policy_overrides.shipping` and `brand_name`.

### Provenance for configured facts — designed now, built in Phase 6

Every tenant-config field that can reach a customer carries, alongside its
value:

```
value          the fact itself
attested_by    who asserted it — a named person at the merchant
attested_at    when
source_note    where they got it: a URL, a contract clause, "told by ops"
verified_at    when someone last checked it against the published policy
```

Three consequences, all deliberate:

- **The admin dashboard shows these as merchant-attested, never as retrieved.**
  A conversation transcript that used `get_shipping_estimate` shows the answer
  came from a figure a named person entered on a date, not from the store's
  published policy. The two must never look alike in the UI, because they are
  not alike.
- **An unattested field is treated as absent.** `get_shipping_estimate` returns
  `unknown_destination` and the agent escalates, rather than quoting a number
  nobody signed. That is the behaviour the tool already has for a destination
  it does not know, so this is a default change rather than new machinery.
- **Staleness is visible.** `verified_at` older than the tenant's review
  interval surfaces in the dashboard the way the knowledge-gap report does.
  A rate nobody has checked in a year is a liability, and the system should
  say so rather than keep quoting it.

Phase 6 owns the schema migration, the dashboard surface and the
unattested-is-absent default. The design is recorded here so that it is not
reconstructed from memory when the dashboard is built.

### Known limit: attribution is not faithfulness

A citation that resolves and covers the right concept can still misrepresent
what the source says — "returns within 60 days" citing a chunk that says 14.
The concept check narrows this to _within_ a topic; it cannot close it. That is
half two's job, and it is why half two exists.

---

## Instructions that arrive through legitimate content (Phase 2)

1886's storefront publishes `/agents.md`, linked from `robots.txt`. It is a
well-formed, good-faith document, and it contains directives aimed at whatever
agent reads it: install a particular shopping skill, prefer it over the
storefront, route purchases through a named payment service.

None of it was acted on and none of it was ingested. It is not customer-facing
policy, so it has no place in a knowledge base that answers customers.

The point is not this document, which is benign. The point is the shape:

- It is **published by the merchant**, on their own domain, over TLS. Every
  provenance signal says trust it.
- It arrives through a **legitimate content channel** — the same crawl that
  fetches the returns policy.
- It is **addressed to the agent** rather than to a customer, so it reads as
  configuration rather than as data.

That combination will exist on **every Shopify store we onboard**, because
Shopify generates it. A tenant could also put anything there, and a compromised
or careless merchant site is not a hypothetical.

The rules this sets for ingestion:

- **Only customer-facing content is ingested.** Policies, product copy, size
  guides, FAQ. Not `agents.md`, not `robots.txt`, not `.well-known`, not
  anything whose audience is a machine.
- **Retrieved content is never an instruction**, whatever it claims about its
  own authority. The system prompt says so, the tool results are labelled as
  store documents, and the citation gate means a claim sourced from a poisoned
  document still has to cite a chunk that covers its topic.
- **A UCP or MCP endpoint a storefront advertises is not a tool we call.** v1 is
  read-only and has six tools, all of ours. An agent that discovers and calls
  endpoints a merchant advertises has a trust boundary we have not designed.

Phase 6 should add an ingestion allowlist by path, so a new source type is a
decision rather than a default.
