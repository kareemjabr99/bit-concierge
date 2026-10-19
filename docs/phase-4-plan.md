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
2. **Credentials, encrypted.** `shopify_installs`, sealed with AES-256-GCM by
   `packages/core/src/crypto.ts`. Read-only scopes only; the agent answers
   questions and never changes an order. (This line used to name a
   `tenant_shopify_credentials` table and ADR 0007; neither exists — 0007 is
   retention.)
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

Updated 2026-10-19, at the gate.

| Definition-of-done item                                                    | State                                                                                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Real order fetched and answered, literal gate passing on Admin API figures | **met** 2026-10-19 — [evidence](evidence/2026-10-19-phase-4-dod.md)                                                                        |
| Mismatched-email and guest-checkout cases against real data                | **met** — both verify on real shapes and refuse a wrong email; two first-run replies withheld for a mis-cited tool, both answered re-asked |
| A throttled request escalating, under test                                 | done                                                                                                                                       |
| The mock client still passing the full suite                               | done — the eval runner is on the factory with `--store mock`                                                                               |
| The bar unchanged                                                          | unchanged                                                                                                                                  |

Plan items 1, 3 and 5 are done. Item 4, webhooks, is half done by choice: the
receiver verifies and queues; nothing consumes the job yet, because re-indexing
spends embedding quota on every merchant edit and that is the owner's call
(below). Item 2, credentials sealed in `shopify_installs`, stays unbuilt: the
owner's 2026-09-24 decision makes environment credentials the development
source, and the installs path is first needed by a second store (Phase 6).

### Built at the close (2026-10-18 and 19)

- **Token renewal** (`1b8fbb0`). The transport takes a token source; the cache
  renews inside its five-minute margin, shares one grant between concurrent
  lookups, and a 401 discards the token and mints once without spending a
  throttle attempt. The precondition below.
- **`apps/web` on the factory** (`446b265`), the last entry point that built the
  mock itself. A repo guard (`test/store-choice.test.ts`) fails if anything but
  the factory constructs `MockShopifyClient`.
- **Escalation email** (`71c24f3`). `escalate()` enqueues an id-only job in the
  row's transaction (in a savepoint, so a failed queue costs the email, never
  the escalation); the worker sends it through Resend and marks the row `sent`
  or `failed`; over the hourly cap, one digest per tenant per hour. The queue
  is pg-boss in its own schema (migration 0008). Not delivered for real: no
  Resend account exists.
- **Webhook receiver** (`a0474e3`). `POST /webhooks/shopify`, signature checked
  over the raw body before anything is read, product topics queued as
  `product-changed` with the product id only. Not subscribed: nothing is
  deployed and there is no public URL.

### Mutation results, for the gate report

Standing policy is that correctness-critical components are mutation-tested
before their gate closes and the results are recorded. Twenty-five mutants
across this phase's first components; twenty-four killed, one survived and was
answered by deleting the code rather than by writing a test for it. The status
link (ADR 0012, six of six) and the 2026-10-12 gate changes (21 of 21) are
recorded with their commits. The close added the last four rows: 37 mutants,
37 killed, one of them only after the mutant itself was corrected.

| Component                             | Mutants | Killed | Note                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mock/store mirror + golden-set guards | 8       | 8      | stock drift, continue-selling flag, both email bugs, a store-side price change, a stale order number, an email that verifies when a refusal is expected                                                                                                                                                                                                                                              |
| Credential guard                      | 3       | 2      | the survivor was an early return `matches` already covered — dead code, removed                                                                                                                                                                                                                                                                                                                      |
| Stock level                           | 4       | 4      | the old in_stock behaviour, policy ignored, availability veto removed, threshold off by one                                                                                                                                                                                                                                                                                                          |
| Read client and mapper                | 6       | 6      | exact-match filter dropped, two matches accepted, customer text unquoted, drafts surfaced, money truncated, FULFILLED read as in transit                                                                                                                                                                                                                                                             |
| Payment states in lookup_order        | 3       | 3      | partially paid no longer handed over, payment field exposed on an authorized order, the second total dropped                                                                                                                                                                                                                                                                                         |
| Token renewal (2026-10-18)            | 12      | 12     | fixed string wired in, no mint at start, 401 without invalidate, static token retried, no retry, unbounded retry, source token unchecked, margin ignored, no shared grant, failed grant stuck in flight, invalidate a no-op, cache keyed by app only. The fixed-string mutant first survived because the mutant was written wrong (it never reached the transport); corrected, killed                |
| Store choice guard                    | 1       | 1      | apps/web constructing the mock again                                                                                                                                                                                                                                                                                                                                                                 |
| Escalation email and queue            | 15      | 15     | no row lock (two deliveries both send), non-pending sent, empty recipients sent, refusal retried, last attempt left pending, status link forwarded, idempotency key per attempt, digest keyed by its own row, digested rows re-sent, failed digest row kept, 429 not retried, every 409 retried, enqueue outside the transaction, queue failure failing the escalation, digested rows emailed singly |
| Webhook receiver                      | 9       | 9      | signature skipped, empty secret accepted, digest prefix accepted, every topic queued, failed enqueue acknowledged, no body limit, any gid accepted, no delivery dedupe, dedupe key without a window                                                                                                                                                                                                  |

### The decision the wiring needs — what Shopify's docs say

Checked 2026-09-24, before changing anything. Nothing has been changed.

- **Client credentials cannot reach a merchant's store.** "The client
  credentials grant only works when the app and the store belong to the same
  Shopify organization," and "can't reach a store outside your organization,
  including a client's store." It works here only because the development store
  and the app share Bit68's development organization.
  ([source](https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens))
- **A merchant's store is reached by custom distribution and the authorization
  code grant**, for an app that runs outside the Shopify admin, as this one
  does. That produces a **per-store offline access token** — the shape
  `shopify_installs` already stores.
- **Non-expiring offline tokens remain available to custom apps.** Public apps
  must use expiring ones — a one-hour access token plus a rotating 90-day
  refresh token — for the Admin API from 1 January 2027, and "this doesn't
  apply to custom apps." `shopify_installs` has no refresh-token column, which
  is correct for custom distribution and would need a migration if Bit68 ever
  distributed publicly.
  ([source](https://shopify.dev/docs/apps/build/authentication-authorization/access-token-types/offline-access-tokens))
- **Custom distribution is one store, or one Plus organization, per app, and
  the choice cannot be changed afterwards.** Each further merchant is a further
  app registration, and there is no Billing API.
  ([source](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method))

Which makes the earlier framing here wrong. Moving the schema towards a stored
client secret would have reshaped production around the one environment where
client credentials work at all. Per the owner's conditional decision on
2026-09-24, the schema stays; client credentials become a development and
same-organization credential source read from the environment. Not built yet.

## Preconditions for `apps/web` (decided 2026-10-12, met 2026-10-18)

- **Token refresh.** The factory (`packages/shopify/src/factory.ts`) mints one
  24-hour access token at start and hands it to `AdminTransport` as a fixed
  string. That is correct for a CLI session and wrong for a server that stays
  up: on day two every lookup fails with an authentication error, which becomes
  a hand-over to a person for every order question. Before `apps/web` uses the
  factory, the transport must take a token _source_ (the `AccessTokenCache`
  already tracks expiry and exposes `invalidate`), renew before expiry, and on
  a rejected token invalidate and retry once. Needs a test with an injected
  clock. **Done** in `1b8fbb0`; tests in `factory.test.ts` and
  `token-source.test.ts`.
- **The status-link rules** in [ADR 0012](adr/0012-order-status-link.md) apply to
  every entry point; `apps/web` stores transcripts and is where the
  "database is not contained" caveat bites.

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
