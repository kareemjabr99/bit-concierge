# Bit Concierge

Multi-tenant conversational commerce agent for Shopify. Bit68-owned IP, licensed
per store. Answers a merchant's customers on the storefront widget, Instagram DM
and WhatsApp, in English and Arabic.

The architectural rule everything else follows from: **"where is my order" is a
tool call, not a retrieval.** Order, price and stock facts come from live
Shopify calls. Policies, sizing and care come from retrieval. The two never
cross, and a deterministic gate checks that before any reply is sent.

> Status: **Phase 1 complete.** The agent loop, six tools, both grounding
> gates and a CLI harness — running against a synthetic store and a fixture
> knowledge base. No real retrieval, no Shopify connection, English-first.

---

## Running it

You need Docker and Node 24.

```bash
corepack enable
pnpm install
docker compose up -d postgres
```

Copy the environment template and fill it in. `.env.local` is gitignored and is
the only file that ever holds a value.

```bash
cp .env.example .env.local
```

For local work, point both database URLs at the container:

```
DATABASE_URL_MIGRATOR=postgres://postgres:postgres@localhost:55432/bitconcierge
DATABASE_URL=postgres://bitc_app_local:localdev@localhost:55432/bitconcierge
```

Then bring the schema up and create the local application login role:

```bash
pnpm db:migrate
psql "$DATABASE_URL_MIGRATOR" -f packages/db/scripts/bootstrap-local.sql
pnpm verify
```

`pnpm verify` runs lint, typecheck and the full test suite. It is what CI runs.
The suite creates and owns `bitconcierge_test`; it never touches the database
in `DATABASE_URL`, so your seeded tenant and conversations survive it.

## Talking to it

Seed the development tenant once, then open the harness. It needs
`GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local` — synthetic data only on a
free-tier key, see ADR 0006.

```bash
pnpm db:seed
pnpm --filter @bitc/cli chat -- --debug
```

`--debug` shows every tool call, both gate verdicts, the raw model text when
it differs from what was delivered, tokens and latency. `/new` starts a fresh
conversation, `/quit` leaves.

| Command                | Does                                     |
| ---------------------- | ---------------------------------------- |
| `pnpm verify`          | lint + typecheck + tests                 |
| `pnpm db:migrate`      | apply pending migrations                 |
| `pnpm db:rollback [n]` | revert the last n migrations (default 1) |
| `pnpm db:reset`        | revert everything                        |
| `pnpm db:status`       | which migrations are applied             |

---

## Layout

Two deployable processes, ten libraries.

```
apps/web       Shopify embedded admin + widget chat API + webhooks  (Phase 3–4)
apps/worker    pg-boss consumer: ingest, embed, re-index, escalate  (Phase 2)
apps/widget    Shadow DOM storefront embed                          (Phase 3)
apps/cli       conversation harness

packages/core      env, redacting logger, errors, identifiers
packages/db        Drizzle schema, migrations, RLS, withTenant()
packages/models    chat / embedding / reranker provider abstraction
packages/agent     tool-calling loop, six tools, both grounding gates
packages/rag       chunking, ingestion, hybrid retrieval            (Phase 2)
packages/shopify   read-only store interface; mock now, Admin GraphQL in Phase 4
packages/channels  message envelope and channel adapters            (Phase 6)
packages/evals     eval harness and golden sets                     (Phase 2)
```

Internal packages are consumed as TypeScript source — there is no build step for
them, and relative imports name the real `.ts` file. Only the two apps bundle.

---

## The rules this codebase enforces mechanically

Not by convention. By something that fails.

**Tenant isolation is a database property.** Every tenant-scoped table has a
row-level security policy. The application connects as `bitc_app`, which holds
no `BYPASSRLS` and does not own the tables. `withTenant()` is the only way
application code reaches tenant data; eslint blocks importing the unscoped
handle outside `packages/db`. The suite in `packages/db/test/rls.test.ts` proves
it by talking raw SQL as the app role — and it has been mutation-tested, so it
fails when a policy is removed. See [ADR 0003](docs/adr/0003-multi-tenancy.md).

**Vectors cannot be silently mixed.** The embedding model is part of the primary
key on `chunk_embeddings`, and retrieval always filters on the tenant's active
model. A model swap is a backfill and a config flip, never a destructive
migration. See [ADR 0004](docs/adr/0004-embeddings.md).

**Secrets cannot enter history.** `test/secrets.test.ts` scans every tracked
file on every pull request for provider key shapes, private key blocks and
credentialled connection strings, and asserts `.env.example` carries names with
no values.

**Logs cannot carry PII.** Everything written through `createLogger` passes
through `redact()` — sensitive field names are replaced wholesale, and remaining
strings have emails, phone numbers and long digit runs stripped. There is one
write path and it cannot be bypassed by accident.

**A fact the tools did not return cannot reach a customer.** Every reply
passes a deterministic gate before delivery: order numbers, tracking
references, URLs, prices, dates and stock claims must appear in that turn's
tool results, and every policy sentence must cite the retrieved chunk it came
from. A miss withholds the reply, records the verdict with the raw model text
on `messages.grounding`, and escalates. See [ADR 0005](docs/adr/0005-grounding.md).

**An order is never revealed on an order number alone.** Order number plus a
matching email, compared in constant time, with a wrong email and a
nonexistent order producing byte-identical results — asserted by a test.

**Migrations cannot be edited after the fact.** Each is checksummed when
applied; changing an applied migration fails the next run with an instruction to
write a new one instead.

---

## Decisions

Recorded in [`docs/adr/`](docs/adr/). Read 0003, 0004 and 0005 before changing
anything in `packages/db`, `packages/rag` or `packages/agent`.

|                                            |                                                              |
| ------------------------------------------ | ------------------------------------------------------------ |
| [0001](docs/adr/0001-hosting.md)           | Fly.io, single `fra` region, two apps from one image         |
| [0002](docs/adr/0002-datastore.md)         | Neon Postgres in Frankfurt; portability as a hard constraint |
| [0003](docs/adr/0003-multi-tenancy.md)     | Row-level security from the first migration                  |
| [0004](docs/adr/0004-embeddings.md)        | Vectors in their own table, 1536 dimensions                  |
| [0005](docs/adr/0005-grounding.md)         | The two halves of the hallucination bar                      |
| [0006](docs/adr/0006-model-abstraction.md) | Provider registry, and evals bound to a model                |
| [0007](docs/adr/0007-retention.md)         | Retention, anonymisation, hard deletion                      |
| [0008](docs/adr/0008-limits.md)            | Token caps, rate limits, escalation digests                  |

---

## Toolchain

|            |         |                                             |
| ---------- | ------- | ------------------------------------------- |
| Node       | 24 LTS  | pinned in `.nvmrc`, Dockerfile and CI       |
| TypeScript | 5.9.3   | **not 7** — see below                       |
| Postgres   | 18      | `arabic` text search configuration is stock |
| pgvector   | ≥ 0.8.0 | asserted by migration 0001                  |
| pnpm       | 12.3.4  | `packageManager` field                      |

TypeScript 7.0.2 is stable and roughly ten times faster, and it was the intended
pin. It is not usable here yet: `typescript-eslint@8.70.0` declares
`typescript >=4.8.4 <6.1.0` and no release supports TS 7, because it needs the
stable compiler API that lands in TypeScript 7.1. Type-aware lint rules matter
more in an async, queue-driven codebase than build speed does at this size, so
we are on 5.9.3. Moving to 7 is a version bump in `package.json` once
typescript-eslint ships support.
