# Phase 4 — real Shopify

## The constraint, on the record

**Nothing in Phase 4 touches a real merchant store.**

The Bit68 development store is the only Shopify that exists for this project
until there is a signed agreement with 1886. No production credentials, no live
storefront, no real customer records, no webhooks pointed at anything outside a
URL under our control.

This is not a phase boundary that gets relaxed if the development store turns
out to be inconvenient. If something can only be tested against a real store,
it waits for the agreement.

It also follows from ADR 0006 independently: the development key is free-tier,
free-tier prompts train the provider's models, and a real order is a real
person's name and address. A paid key under a data-processing agreement is a
precondition for real data regardless of what Phase 4 does.

## What Phase 4 is

Replace `MockShopifyClient` with a real Admin API client behind the same
interface, and keep both working.

1. **A real read client.** `ShopifyReadClient` already defines the surface:
   `getOrderByName`, `getProductByHandle`, `searchProducts`,
   `checkAvailability`. The mock is not thrown away — it is what the eval suite
   runs against, costing no API calls and no rate limit.
2. **Credentials, encrypted.** `tenant_shopify_credentials` with AES-256-GCM at
   rest, ADR 0007. Read-only scopes only; the agent answers questions and never
   changes an order.
3. **The identity gate against real shapes.** Guest checkout means no customer
   record. A different email on the order than on the account is normal. Both
   are in the seed spec because both are how the gate gets tested rather than
   assumed.
4. **Webhooks for incremental ingest.** Product and page updates re-index
   without a full crawl. `apps/worker` exists for this.
5. **Rate limits and failure.** Shopify's Admin API is cost-based and will
   throttle. A throttled lookup must escalate rather than guess, and that path
   needs a test, not a hope.

## What Phase 4 is NOT

- **Not quality work.** See below.
- Not the embedded admin UI. That is Phase 6.
- Not multi-store. One tenant, one store.
- Not write operations. Ever, on current scope.

## Carried in, not fixed here: the four unstable cases

`returns-gift`, `returns-quality-check`, `shipping-track-how`,
`sizing-true-to-size`.

All four flip between answering and giving up on a question the corpus answers.
After the metric fix these are the entire measurable quality problem — 10 of
101 cases still vary in verdict, and these four are the ones that matter.

**They are deliberately not fixed in Phase 4.** Shopify integration changes what
the tools return; quality work changes what the agent does with it. Doing both
in one phase makes it impossible to say which caused a number to move, and this
project has already been bitten twice by a measurement whose cause was
ambiguous.

They go to **Phase 5**, where a merchant-validated question set provides an
actual reason to prefer answering over handing over — which is the thing
currently missing. Right now both behaviours are defensible and there is no
principled basis for choosing.

## Definition of done

- A real order fetched from the development store, answered by the agent, with
  the literal gate passing on figures that came from the Admin API.
- The mismatched-email and guest-checkout cases exercised against real data.
- A throttled request escalating, under test.
- The mock client still passing the full suite — both clients, one interface.
- The bar unchanged: zero fabricated literals and zero uncited claims reaching
  a customer.

## Where it stands

| Definition-of-done item                                                    | State                                        |
| -------------------------------------------------------------------------- | -------------------------------------------- |
| Real order fetched and answered, literal gate passing on Admin API figures | client done, not yet wired into a turn       |
| Mismatched-email and guest-checkout cases against real data                | read and compared; not yet through the agent |
| A throttled request escalating, under test                                 | done                                         |
| The mock client still passing the full suite                               | done — 687 tests                             |
| The bar unchanged                                                          | unchanged                                    |

The store was seeded, the 16 cases were remapped, and four more moved with
them. `ShopifyAdminClient` reads it. What is left is the wiring: which client a
turn gets, and where a tenant's credentials come from.

### Mutation results, for the gate report

Standing policy is that correctness-critical components are mutation-tested
before their gate closes and the results are recorded. Twenty-two mutants
across this phase's components; twenty-one killed, one survived and was
answered by deleting the code rather than by writing a test for it.

| Component                             | Mutants | Killed | Note                                                                                                                                                    |
| ------------------------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mock/store mirror + golden-set guards | 8       | 8      | stock drift, continue-selling flag, both email bugs, a store-side price change, a stale order number, an email that verifies when a refusal is expected |
| Credential guard                      | 3       | 2      | the survivor was an early return `matches` already covered — dead code, removed                                                                         |
| Stock level                           | 4       | 4      | the old in_stock behaviour, policy ignored, availability veto removed, threshold off by one                                                             |
| Read client and mapper                | 6       | 6      | exact-match filter dropped, two matches accepted, customer text unquoted, drafts surfaced, money truncated, FULFILLED read as in transit                |

### The decision the wiring needs

`shopify_installs` stores an encrypted **access token**, which is the shape of
the classic OAuth install flow. The Dev Dashboard app does not have one: it has
a Client ID and a Client Secret, and the token is minted from them and lives 24
hours. So the durable secret to encrypt per tenant is the client secret, and
the access token should not be persisted at all — it is already held in memory
and discarded.

That is a schema change rather than a wiring detail, so it is a decision to
take rather than a default to pick.

## Carried to Phase 5, alongside the four unstable cases

**Latency. p95 is 8–9 seconds and two cases in run 6 exceeded the 45-second
budget entirely.**

The widget now shows the wait rather than hiding it, which is the right
handling and is not a fix. `docs/prompt-caching.md` establishes that the model
bill is not worth optimising — but the same two thirds of every turn that make
up the token cost are retrieved chunks and history, and fewer or smaller
passages would move latency far more visibly than they would move the bill.

That is the better reason to touch retrieval, and it belongs with the
validated question set: changing what is retrieved changes what can be
answered, and there is currently no principled basis for trading one against
the other.
