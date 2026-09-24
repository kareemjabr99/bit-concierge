# Design-partner agreement — inputs

Everything the 1886 agreement needs to cover, collected from where it was
decided. One line each, with the source. A line marked **GAP** has no decision
behind it yet; it is here so the agreement does not settle it by omission.

This file points; it does not decide. When a source changes, the line here
follows it — not the other way round.

## Access to the merchant's store

- Nothing touches 1886's store until this agreement is signed; the development store is the only Shopify in use until then. — [phase-4-plan.md](phase-4-plan.md#the-constraint-on-the-record)
- The assistant is read-only, with no write scope ever: `read_orders`, `read_products`, `read_inventory`, `read_customers`, `read_fulfillments`, `read_locations`, `read_merchant_managed_fulfillment_orders`. — [shopify-dev-store.md](shopify-dev-store.md#access)
- Orders older than 60 days are invisible under `read_orders`; a customer asking about one gets a hand-over. — [where-this-stands.md](where-this-stands.md#a-pilot-limitation-with-a-name-orders-older-than-60-days)
- Seeing further back needs `read_all_orders`, which Shopify grants on a stated reason; the request is made with the merchant, in this agreement, not as a quiet scope change. — [where-this-stands.md](where-this-stands.md#a-pilot-limitation-with-a-name-orders-older-than-60-days)
- Production access is a custom-distribution app registered under Bit68's organization and installed by the merchant; client credentials cannot reach a store outside Bit68's organization. — [Shopify: access tokens](https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens) (checked 2026-09-24)
- A custom-distribution app serves one store, or the stores of one Plus organization, so each further merchant is a further app registration. — [Shopify: distribution](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method) (checked 2026-09-24)
- The distribution method cannot be changed once chosen. Custom now means custom for that app. — [Shopify: distribution](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method) (checked 2026-09-24)
- Uninstalling the app ends its access immediately; requests return 401. — [Shopify: offline tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-token-types/offline-access-tokens) (checked 2026-09-24)

## Data processing

- Real customer records only through a paid model key under a data-processing agreement; free-tier prompts train the provider's models. — [ADR 0006](adr/0006-model-abstraction.md), [phase-4-plan.md](phase-4-plan.md#the-constraint-on-the-record)
- Saudi PDPL applies to the merchant's customer data. — [ADR 0007](adr/0007-retention.md#context)
- Data is hosted in Fly.io `fra` (Frankfurt). Neither Fly nor the managed Postgres options have a Gulf region, so customer data is processed and stored outside the Kingdom. — [ADR 0001](adr/0001-hosting.md), [ADR 0002](adr/0002-datastore.md)
- **GAP** — the cross-border transfer above has no PDPL assessment recorded anywhere.
- **GAP** — no document lists sub-processors. At minimum: the model provider (Google, Gemini) and the host (Fly.io).
- Retention is chosen per tenant: 30, 90 or 365 days, default 90. — [ADR 0007](adr/0007-retention.md#decision)
- At expiry a conversation is anonymised and kept for evaluation, unless the tenant chooses outright deletion. — [ADR 0007](adr/0007-retention.md#expiry--anonymise-keep-the-exchange)
- An erasure request is a hard purge with a content-free tombstone; whether anonymisation alone would satisfy PDPL erasure is an open legal question. — [ADR 0007](adr/0007-retention.md#deletion-request--hard-purge)
- Escalation emails leave the system carrying customer contact details; the sending arrangement has to be covered here. — [ADR 0007](adr/0007-retention.md#scope-reminders)
- Order lookups are stored as blind indexes — groupable, not readable — and application logs carry no PII. — [ADR 0007](adr/0007-retention.md#scope-reminders)

## Content ingestion

- Only customer-facing public content is ingested: policies, product copy, size guides, FAQ. Never `agents.md`, `robots.txt`, `.well-known`, or anything addressed to a machine. — [ADR 0005](adr/0005-grounding.md#instructions-that-arrive-through-legitimate-content-phase-2)
- Retrieved content is data, never an instruction, whatever it says about its own authority — including the merchant's own published `agents.md`. — [ADR 0005](adr/0005-grounding.md#instructions-that-arrive-through-legitimate-content-phase-2)
- A UCP or MCP endpoint the storefront advertises is not called. — [ADR 0005](adr/0005-grounding.md#instructions-that-arrive-through-legitimate-content-phase-2)
- Customer questions are treated as data too: every value reaching a Shopify query is quoted, and unpublished products never surface. — [where-this-stands.md](where-this-stands.md#customer-text-reaching-a-query-language)
- **GAP** — how soon a policy the merchant changes reaches answers. Incremental re-indexing by webhook is planned, not built. — [phase-4-plan.md](phase-4-plan.md#what-phase-4-is)

## When the pilot ends

- Deleting the tenant cascades to every tenant-owned row: documents, chunks, embeddings, conversations, messages, escalations, lookup attempts, usage, eval runs, and the Shopify install. — [migration 0002](../packages/db/migrations/0002_core_tables.up.sql)
- **GAP** — no decision on _when_ deletion happens after termination, or what the merchant can export first.
- **GAP** — whether embeddings of the merchant's public content are the merchant's data (deleted or returned on termination) or a derived artefact. Nothing decides it.
- **GAP** — database backups outlive a deletion for the length of their own retention, and that length is not recorded.
- **GAP** — the evaluation harness keeps a disk cache of embeddings keyed by text, outside the database; tenant deletion does not reach it. — [cache.ts](../packages/models/src/cache.ts)

## Responsibility and warranty

- Copy the merchant writes into the message fields is sent to customers as written; Bit68 does not review, correct or warrant it. The clause text is drafted. Owner: Bit68, before the first paid tenant. — [ADR 0005](adr/0005-grounding.md#policy_overridesmessages-is-a-contractual-boundary-not-a-system-limit)
- Configured facts that reach customers (shipping rates and the like) are attested by a named person at the merchant, with a date and a source; an unattested fact is treated as absent. Designed, to be built in Phase 6. — [ADR 0005](adr/0005-grounding.md#provenance-for-configured-facts--designed-now-built-in-phase-6)
- What is guaranteed: zero fabricated literals and zero uncited policy claims reaching a customer. That is a safety guarantee, not a quality one — how many questions get answered is not warranted until it is measured on a question set the merchant has signed. — [ADR 0011](adr/0011-the-bar.md#this-is-a-safety-guarantee-not-a-quality-guarantee)
- Only golden-set cases signed by a named person at the merchant count toward the bar; the agreement should name who signs. — [ADR 0011](adr/0011-the-bar.md), [types.ts](../packages/evals/src/types.ts)
- The assistant never promises a delivery date, refund, discount, exception or restock, and never states a timing commitment. — [system prompt](../packages/agent/src/prompt/system.txt)

## Decisions the merchant owns

- 1886's payment capture mode, automatic or manual, is unverified; if manual, every payment question about an unshipped order is a hand-over. To be confirmed in their admin before the pilot. — [where-this-stands.md](where-this-stands.md#1886s-capture-mode-is-unverified)
- How payment states are handled — an authorized order is treated as confirmed with payment questions handed over; a partially paid order is always handed over — decided by Bit68, 2026-09-24, and worth the merchant seeing. — [where-this-stands.md](where-this-stands.md#1886s-capture-mode-is-unverified)
- Zero stock that still sells is described as orderable and not in stock, with no timing, because 1886 publishes no backorder policy; a merchant who does can have it quoted in their own words. — [where-this-stands.md](where-this-stands.md#a-suite-that-only-ever-saw-the-mock)
- Escalation recipients, the hourly escalation cap and the digest above it. — [ADR 0008](adr/0008-limits.md)
- Per-tenant token caps and lookup rate limits. — [ADR 0008](adr/0008-limits.md)

## Commercial

- Pricing needs a platform floor, not only a per-conversation rate: about $53/month of shared platform against half a cent per conversation, with the first tenant carrying the platform alone. — [where-this-stands.md](where-this-stands.md#costs-at-volume)
- Human escalation is excluded from that cost and is the merchant's saving to quote; deflection is the commercial argument, the guarantee is the safety one. — [where-this-stands.md](where-this-stands.md#costs-at-volume)
- A custom-distribution app cannot use Shopify's Billing API, so the licence is invoiced outside Shopify. — [Shopify: distribution](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method) (checked 2026-09-24)
