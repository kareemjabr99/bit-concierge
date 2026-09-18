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

## Blocked on

The development store, per `docs/shopify-dev-store.md`. Order numbers are
assigned by Shopify and cannot be chosen, so 16 golden-set cases need remapping
once the store exists — a fixture correction, recorded, not an expectation
change.
