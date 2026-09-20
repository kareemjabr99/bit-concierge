# Shopify development store — seed specification

What to create before Phase 4 starts, so the phase is integration work rather
than discovering gaps.

> **Nothing in Phase 4 touches a real merchant store.** The development store
> is the only Shopify that exists for this project until there is a signed
> agreement with 1886. No production credentials, no live storefront, no real
> customer records. Recorded here and in the Phase 4 plan.

---

## The store, and how to seed it

Store: `bit-concierge-dev-blb8x6ix.myshopify.com` — dev type, Basic plan, SAR,
metric, Riyadh time zone, order prefix `1886-`.

Seeded by script rather than by hand:

```bash
pnpm --filter @bitc/shopify run seed:check     # verify access, writes nothing
pnpm --filter @bitc/shopify run seed:dry-run   # show the plan, writes nothing
pnpm --filter @bitc/shopify run seed           # create
```

`--check` runs first on purpose. It confirms the token, the currency, every
mutation the script needs and every write scope, and reports what is missing —
rather than failing halfway through and leaving the store half-seeded, which is
worse than not starting.

Everything created is tagged `bitc-seed`, and each order also carries a
scenario tag. The script looks for those before creating anything, so
re-running adds nothing.

### Prices and size charts live in the script

`packages/shopify/scripts/seed-dev-store.ts` holds them, and that is
deliberate: the literal gate checks every number in a reply against what the
tools returned, so a price that differs between the store and this project
produces a suppression that looks like a bug and is not. Per
`docs/fixtures.md` rule 2, this is configuration reaching a customer — sourced
or absent — and the script is the source.

| product              | SAR    | notes                                                    |
| -------------------- | ------ | -------------------------------------------------------- |
| Riyadh Oversized Tee | 189.00 | chest L = **63 cm**, XL front length **74 cm**           |
| TFMC Logo Tee        | 215.00 | chest L = **65 cm**, XL front length **77 cm**           |
| Classic Jacket SS24  | 749.00 | S = 0 but **still selling**; L = 0, genuine out-of-stock |
| Sadu Hoodie          | 459.00 | M = **2**, low stock                                     |
| TFMC Tote Bag        | 129.00 | **no size chart**, on purpose                            |
| Japanese Pants       | 389.00 | second size chart                                        |
| 1886 Mask            | 79.00  | **archived** — findable, not purchasable                 |

Two tees with different measurements is the point: `sizing-tee-chest` exists
because the agent must say measurements vary by style rather than pick one.

### The seed token never reaches the agent

`SHOPIFY_SEED_TOKEN` carries write scopes. The agent is read-only and uses a
different app's token. Two things enforce that rather than one person
remembering:

- `assertNotSeedToken` refuses that value in the runtime Admin client, matched
  **by value, not by variable name** — a check on the name alone would miss the
  same secret arriving as `SHOPIFY_ACCESS_TOKEN`, which is exactly how the
  mistake gets made.
- `test/seed-token-isolation.test.ts` fails if any runtime file so much as
  names the variable.

Delete the seed app once seeding is done.

## Read this first: order numbers cannot be chosen

Shopify assigns order numbers sequentially from 1001. The **prefix and suffix**
are configurable (Settings → General → Order ID format); the number is not, and
`name` is read-only through the Admin API.

The golden set currently hard-codes `#1886-2041` through `#1886-2045` across
**16 cases**, because the mock fixtures invented them.

**Please set the order ID prefix to `1886-` and create the orders in the order
listed below.** They will come out as `#1886-1001`, `#1886-1002`, … and I will
update the 16 cases to match once the store exists. What matters is the
sequence, so that the mapping is mechanical rather than guesswork.

Do not try to force the old numbers. A store configured to make a fixture true
is a store that is lying to the test suite.

---

## Customers

Emails **are** controllable and the cases depend on them exactly. Create these
as customer records, all on RFC 2606 reserved domains.

| email               | role                                |
| ------------------- | ----------------------------------- |
| `ahmed@example.com` | the happy path                      |
| `sara@example.com`  | unshipped order                     |
| `layla@example.com` | delivered order                     |
| `omar@example.com`  | cancelled order — **account email** |
| `nora@example.com`  | partially refunded                  |

No real addresses, no real phone numbers, no anyone-you-know. These reach a
free-tier model key, which trains on its prompts (ADR 0006).

---

## Orders — create in this order

### 1. Happy path, in transit — `ahmed@example.com`

- Paid, fulfilled, one fulfilment **in transit** with a tracking number and URL
- 1 × Riyadh Oversized Tee, size M
- Ships to Riyadh, SA

The case it serves is the whole product: _"where is my order"_ answered from a
tool, never from retrieval.

### 2. Paid but unshipped — `sara@example.com`

- Paid, **unfulfilled**, no fulfilments at all
- 2 line items, so _"what did I order"_ has something to list
- Ships to Jeddah, SA

Tests that the agent does not invent a tracking number for an order that has
none, and does not promise a date.

### 3. Delivered — `layla@example.com`

- Paid, fulfilled, fulfilment status **delivered**, `updatedAt` a few days ago
- Ships to Dammam, SA

### 4. Cancelled, with a DIFFERENT email on the order — `omar@example.com`

**The most important one, and the easiest to get wrong.**

- Cancelled (`cancelledAt` set), refunded
- Customer account email: `omar@example.com`
- **Order email: `k@example.com`** — a different address

In Shopify: create the order against the customer, then edit the order's
contact email so the two differ. This happens constantly in real stores —
someone checks out with a work address, or a partner's.

Two cases depend on it, and they pull in opposite directions: the agent must
verify against **either** email, and must not leak that the other exists.

### 5. Partially refunded — `nora@example.com`

- Paid then **partially refunded** — refund one of two line items
- Fulfilled

_"Why is the total different?"_ The answer must come from the order, and the
agent must not explain a refund policy it has not been shown.

### 6. Guest checkout — no customer account

- Checked out as a guest, so **no linked customer record**
- Order email: `guest@example.com`
- Paid, unfulfilled

Exercises `customerEmail === null` against `email` being present. The identity
gate currently compares both; this is the case that proves it does not crash or
silently pass when one is missing. There is no golden-set case for it yet —
**I will add one in Phase 4**, and it should exist in the store first.

---

## Products

Six is enough, but these six specifically, because the corpus and the golden
set already reference them.

| product              | variants    | inventory                                   | why                                                                                                        |
| -------------------- | ----------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Riyadh Oversized Tee | S, M, L, XL | all in stock, ≥10                           | the default happy path                                                                                     |
| Classic Jacket SS24  | S, M, L     | **L = 0, tracked, do not continue selling** | out-of-stock answer                                                                                        |
| Sadu Hoodie          | S, M, L     | **M = 2**                                   | low stock, and `stock-restock-promise` asks when it returns — the answer must be a hand-over, never a date |
| TFMC Tote Bag        | one variant | in stock                                    | `sizing-no-chart-for-product`: a product with **no size chart**                                            |
| Japanese Pants       | S, M, L     | in stock                                    | second size chart                                                                                          |
| 1886 Mask            | one variant | **archived / unavailable**                  | an item a customer can ask about that is no longer sold                                                    |

### Inventory states that must exist

- **In stock, plenty** — the default
- **Low stock** (1–3) — the agent must not editorialise ("hurry!")
- **Zero, tracked, not continuing to sell** — a genuine out-of-stock
- **Zero, continuing to sell** — on one variant of Classic Jacket, ideally size S.
  This is the state that looks available and is not, and I would rather find out
  in Phase 4 than in front of a merchant.
- **Archived product** — reachable by name, not purchasable

### Size charts

The size cases assert specific measurements. Put these on the product pages so
retrieval and the tool agree:

- T-shirt chest: **L = 63 cm** on one style, **65 cm** on another. Two different
  correct answers is the point — `sizing-tee-chest` exists because the agent
  must say measurements vary by style rather than pick one.
- T-shirt front length: **XL = 74 cm** on one, **77 cm** on another.

---

## Prices

Any plausible SAR figures, but **write them down and give them to me**. The
literal gate checks every number in a reply against what the tools returned, so
a price that differs between the store and the corpus produces a suppression
that looks like a bug and is not.

---

## What I do NOT want in the store

- Any real customer, address, phone number or email
- Any real payment method, even a test card beyond Shopify's own
- Products imported from 1886's live catalogue — invented items on a reserved
  domain, matching the shapes above
- Webhooks pointed anywhere but a URL I control in Phase 4

---

## Access

For Phase 4 I need a **custom app** on the development store with read-only
Admin API scopes:

`read_orders`, `read_products`, `read_inventory`, `read_customers`,
`read_fulfillments`, `read_locations`

**Read-only. The agent has no write scope and should never be granted one** —
it answers questions, it does not change orders. If a scope beyond these turns
out to be needed I will ask rather than widen the request quietly.

The access token goes in `.env.local` and nowhere else. It is encrypted at rest
once stored (`tenant_shopify_credentials`, AES-256-GCM, ADR 0007).

---

## After the store exists

1. I map the assigned order numbers to the 16 cases and update them — a fixture
   correction, recorded, not an expectation change.
2. The mock client stays. It is what the eval suite runs against, and it costs
   no API calls and no rate limit. Phase 4 adds a real client behind the same
   interface; both are exercised.
3. `docs/fixtures.md` rule 2 applies to everything seeded here: it is
   configuration reaching a customer, so it is sourced from this document or it
   is absent.
