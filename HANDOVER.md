# Bit Concierge — Handover

Written 2026-10-11 to move this project to another place: another machine,
another team, or Bit68's GitHub organization. It says what the project is,
**exactly where it stands**, what has to move with it, how to stand it up again,
and what to do next.

[CLAUDE.md](CLAUDE.md) is the short version that Claude Code loads at the start
of every session: what this is, the rules, and where to look. This file is the
long version.

If you read only one section, read [Where it stands](#1-where-it-stands). If you
are about to change code, read [The rules that do not bend](#5-the-rules-that-do-not-bend)
first. Everything here links to the document it summarises; where the two
disagree, the linked document wins and this file is the one to fix.

---

## 0. What this is, in one minute

A multi-tenant conversational commerce agent for Shopify stores. Bit68-owned IP,
licensed per store. It answers a merchant's customers — "where is my order", "do
you have this in medium", "what is your return policy" — on a storefront widget,
and later on Instagram DM and WhatsApp, in English and Arabic.

The first tenant is **1886** (1886riyadh.com), a Saudi elevated-streetwear
brand. **There is no signed agreement with 1886 yet**, and until there is,
nothing in this project touches their store or their customers' data.

The rule everything else follows from: **"where is my order" is a tool call, not
a retrieval.** Order, price and stock facts come from live Shopify calls.
Policies, sizing and care come from retrieval over the store's public pages. The
two never cross, and a deterministic gate checks every reply before it is sent —
a reply carrying a fact no tool returned, or a policy claim with no citation, is
withheld and handed to a person instead.

**The guarantee the product sells:** zero fabricated literals and zero uncited
policy claims reaching a customer. That is a _safety_ guarantee, not a quality
one — it proves the agent never invents a fact; it does not prove it answers
enough questions to be worth paying for. Only the first is currently proven.
See [ADR 0011](docs/adr/0011-the-bar.md).

---

## 1. Where it stands

### Phases

| Phase | Scope                                           | State                                             |
| ----- | ----------------------------------------------- | ------------------------------------------------- |
| 0     | Foundation: monorepo, Postgres + RLS, CI        | ✅ closed                                         |
| 1     | Core agent loop over a mocked store             | ✅ closed                                         |
| 2     | Retrieval (RAG) and the eval harness            | ✅ closed                                         |
| 3     | Storefront widget; the ship bar redefined       | ✅ closed                                         |
| 4     | **Real Shopify** — against a development store  | 🔶 **in progress** — read client built, not wired |
| 5     | Arabic, and validation with the client          | not started                                       |
| 6     | Multi-tenant hardening, admin UI, IG + WhatsApp | not started                                       |

The full history, phase by phase, is in [docs/build-log.md](docs/build-log.md).
The honest assessment written for someone who has to represent this to a client
is [docs/where-this-stands.md](docs/where-this-stands.md) — read it before
quoting any number.

### Phase 4, item by item

From the definition of done in [docs/phase-4-plan.md](docs/phase-4-plan.md#definition-of-done):

| Definition-of-done item                                           | State                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| A real order fetched from the dev store and answered by the agent | **Not yet.** The client reads the store; it is not wired into a turn |
| Mismatched-email and guest-checkout cases against real data       | Read and compared; not yet through the agent                         |
| A throttled request escalating, under test                        | ✅ done                                                              |
| The mock client still passing the full suite                      | ✅ done                                                              |
| The bar unchanged                                                 | ✅ unchanged                                                         |

What exists and works:

- **The development store is seeded** — 7 products, 5 customers, 6 order
  scenarios (shipped, unshipped, delivered, different email on the order,
  partial refund, guest checkout), verified by reading them back. Scenario 1
  was meant to be _in transit_; the store reports it as shipped with no carrier
  scan, because creating a shipment does not make Shopify believe a carrier has
  it. Adding the carrier event is part of step 3 below.
- **The payment-state decisions are tested against constructed orders only.**
  No authorized or partially paid order exists in the store yet; step 3 adds
  them.
- **`ShopifyAdminClient`** — the real read client, Admin GraphQL 2026-07, same
  interface as the mock, written from recorded responses, mutation-tested.
- **`compare:store`** — reads the live store and diffs it field by field
  against the mock the eval suite runs on. It has found four divergences that
  nothing else could have.
- **The mock mirrors the store**, and a test fails if it drifts from the seed
  data. The golden set is remapped onto the order numbers the store assigned.
- **Decided answers** for zero-stock-still-selling, authorized payments and
  partially paid orders.

What is **not built**, so nobody assumes it is:

- The agent does not yet use the real client in a conversation. Every entry
  point (`apps/web`, `apps/cli`, the eval runner) still constructs
  `MockShopifyClient`.
- **No deployment exists.** Fly.io config is in the repo, but `apps/web`'s build
  script is a placeholder that writes an empty file, `apps/worker` is a
  two-line stub, and no Fly app has been created from this machine.
- **Escalation emails are not sent.** An escalation writes a database row; that
  row is the contract until email delivery (Resend) is wired.
- Webhooks for incremental re-indexing — not built.
- `packages/channels` (Instagram, WhatsApp) — a stub. Phase 6.
- The embedded Shopify admin UI — Phase 6.
- Arabic — the schema and search configuration support it; nothing is
  validated. Phase 5.

### Changes to the agent's guards, 2026-10-12

**Escalation order (`755254a`, `packages/agent/src/guard/escalation-order.ts`).**
The `escalate_to_human` tool refuses to hand over until a lookup tool has run
earlier in the same turn: `search_knowledge`, `lookup_order`, `search_products`,
`check_availability` or `get_shipping_estimate`, whatever it returned (a search
that found nothing counts). A refused call writes no escalation row; the model
gets a `search_first` tool error telling it to search. Enforced in the tool, not
the prompt.

- **Exemptions, and no others:** the customer's own message this turn asks for a
  person (read from the customer's text, never from the model's stated reason;
  English and a starting set of Gulf Arabic, unvalidated until Phase 5), and the
  reason `complaint`, the only reason the system prompt escalates immediately.
- **Cap:** after one refusal in a turn (`MAX_ESCALATION_REFUSALS = 1`), the next
  escalation is let through and logged as a warning.
- The loop's own escalations (caps, tool failure, step limit, the grounding
  gate, an outstanding payment) call `escalate()` directly and are not checked.
- **Not measured.** No eval run has happened since. An offline re-score cannot
  show its effect, because it does not ask the model to write anything.

**The citation gate (ADR 0005, two sections dated 2026-10-12).**

- **URL fragments**, in both the literal and the citation check: a URL with no
  fragment is grounded by a returned URL with its fragment stripped; a URL with
  a fragment must match a returned URL exactly. No query strings, no prefixes.
- **Offers of help** are exempt only when the whole sentence equals an entry on
  `OFFERS_OF_HELP`, and never when it carries a number, date, URL or price.
- Mutation-tested, 21 of 21 killed (commit `c3145fd`).
- **Re-score of the 2026-10-11 run**, offline with the `rescore` script in
  `@bitc/evals`: 88 of 108, 72.2% as originally scored, 81.5% after adjudication.
  One verdict changed, `returns-who-pays-pickup` fail → pass. Nothing went from
  pass to fail. `shipping-lost-parcel`, `sizing-tee-chest` and
  `sizing-between-sizes` are still withheld. A re-score of one set of replies,
  not a measurement — see [the history README](packages/evals/history/README.md).

### Numbers, and what they are worth

| Measure                                   | Value                                                    | Worth quoting?                                      |
| ----------------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| Fabricated literals reaching a customer   | 0                                                        | **Yes** — a property, enforced by the gate          |
| Uncited policy claims reaching a customer | 0                                                        | **Yes** — same                                      |
| Accuracy                                  | ~79% on 103 cases, ±3.3 points                           | No — drafted suite, not client-validated            |
| Deflection                                | 77.5%                                                    | No — same; this is the number that would sell it    |
| Escalation precision                      | 73.8%                                                    | No — same                                           |
| Latency                                   | 3.2s median, 8.1s p95, 33s worst                         | Yes, and it is a known weakness                     |
| Model cost                                | $4.70 per 1,000 three-turn conversations                 | Yes, at Google's published paid rate                |
| Platform floor                            | ~$53/month shared, before any tenant                     | Yes — price with a floor, not only per conversation |
| Tests                                     | 691 passing, 39 files — as of the last commit, re-verify | —                                                   |

**Every eval number above predates Phase 4's changes.** Since the last run the
system prompt gained a stock section and a payment rule, `lookup_order`'s output
changed, the golden set was remapped to new order numbers, and a 104th case was
added. Nothing has been re-measured. **The next eval run re-baselines
everything** — see [step 4 of what to do next](#8-what-to-do-next-in-order).

**No baseline is recorded on disk** (`packages/evals/baselines/` is empty). The
**run history is exported** to [packages/evals/history/](packages/evals/history/README.md):
all 11 run summaries, six printed reports, and the run 4/5/6 comparisons with
the twelve flips and their replies — the evidence behind
`where-this-stands.md`. Per-case outputs for each run were lost before the
export; the history's README says exactly what survives.

### Blocked right now

Nothing in Phase 4 is blocked on Shopify. The two blockers recorded here on
2026-10-11 are cleared: the seed app was installed and the store re-seeded with
eight scenarios, and `compare:store` exits 0 since the client reads
`descriptionHtml` (`e858d87`; kept by the owner 2026-10-18). **Uninstall
`bitc-seed` from the dev store** — it was kept installed only until
`compare:store` passed.

---

## 2. What has to move

### 2.1 The code

- **Repository:** `https://github.com/kareemjabr99/bit-concierge` — private,
  personal account, branch `main`. It is meant to transfer to a Bit68 GitHub
  organization. **No org path is hardcoded anywhere**, by rule; after a transfer
  the only change is the remote URL:

  ```bash
  git remote set-url origin https://github.com/<new-owner>/bit-concierge.git
  ```

- Everything is pushed; `main` on GitHub is the whole project. Do not take CI's
  state from this file; check it with `gh run list --limit 1`.
- **This machine has two GitHub accounts.** `karimgabr-PM` has read access
  only; `kareemjabr99` owns the repository. Git takes its GitHub login from
  `gh` (`gh auth setup-git` was run), so pushes follow whichever account
  `gh auth switch` last selected.
- **CI needs no secrets.** It runs against a throwaway Postgres service, so it
  works in a new organization as-is. `pnpm gate` reads CI status through the
  `gh` CLI, so the new owner's `gh` must be authenticated to the new location.
- GitHub **push protection** is relied on. Keep it on in the new organization.

### 2.2 Secrets

Secrets live **only** in `.env.local`, which is gitignored. They never go in a
file that is not `.env.local`, never in chat, never in a commit message. Move
them through a password manager or another channel built for it.

On the current machine `.env.local` already exists in the repo root with its
values filled in. A backup lives outside the repository at `~/.secrets/`. Do not
ask for the values again; on a new machine, copy the file from that backup.

`.env.example` holds every **name** and no value. The ones in use today:

| Variable                                            | What it is                                      | Notes                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`, `DATABASE_URL_MIGRATOR`             | App role (RLS enforced) and migration role      | Local values are in the README                                                                                                 |
| `ENCRYPTION_KEY`, `_VERSION`, `_PREVIOUS`           | AES-256-GCM key ring for credentials at rest    | No production data is sealed with it yet                                                                                       |
| `BLIND_INDEX_SALT`                                  | Salts blind indexes of order numbers and IPs    | Required in production                                                                                                         |
| `GOOGLE_GENERATIVE_AI_API_KEY`                      | Gemini, **free tier**                           | From Google AI Studio. Free-tier prompts train Google's models — synthetic data only                                           |
| `SHOPIFY_STORE_DOMAIN`                              | The development store                           | `bit-concierge-dev-blb8x6ix.myshopify.com`                                                                                     |
| `SHOPIFY_RUNTIME_CLIENT_ID`, `_SECRET`              | The read-only runtime app (`bit-concierge`)     | From `bit-concierge` → App settings in the Dev Dashboard. Seven read scopes, listed in section 2.3; installed on the dev store |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`        | The **seeding** app (`bitc-seed`), write scopes | From `bitc-seed` → App settings in the Dev Dashboard. Never read by the runtime — a test enforces it                           |
| `SHOPIFY_API_KEY`, `_SECRET`, `_APP_URL`, `_SCOPES` | Reserved for the embedded admin app             | Reserved for the future production OAuth app, which does not exist yet. Phase 6                                                |
| `RESEND_API_KEY`, `ESCALATION_FROM_EMAIL`           | Escalation email                                | Not wired yet                                                                                                                  |
| `META_*`, `INSTAGRAM_*`, `WHATSAPP_*`               | Channels                                        | Phase 6                                                                                                                        |

**Rotate when ownership changes.** If this moves to people who should not hold
the current credentials: regenerate the Google key and both Shopify client
secrets in their dashboards. Rotating `ENCRYPTION_KEY` is cheap today because
nothing real is sealed with it; it will not be cheap later.

The seed app's credentials carry write scopes. The guard
(`packages/shopify/src/admin/guard.ts`) refuses them **by value** anywhere a
runtime access token is expected, so a value pasted into the wrong variable
fails loudly rather than giving the agent write access.

### 2.3 External accounts

| Resource                 | Where                                                    | State                                                                                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repository        | `kareemjabr99/bit-concierge`                             | Private; transfer to Bit68 pending                                                                                                                                                                                                                                  |
| Shopify development org  | Dev Dashboard, personal Partner org `bit-concierge-dev`  | Owned by Karim Gabr; holds the dev store and both apps. Not a Bit68 org                                                                                                                                                                                             |
| Development store        | `bit-concierge-dev-blb8x6ix.myshopify.com`               | Dev type, Basic plan, SAR, Riyadh, order prefix `1886-`                                                                                                                                                                                                             |
| App `bit-concierge`      | Read-only runtime app                                    | Installed. Scopes: `read_orders`, `read_products`, `read_inventory`, `read_customers`, `read_fulfillments`, `read_merchant_managed_fulfillment_orders`, `read_locations`                                                                                            |
| App `bitc-seed`          | Seeding app, write scopes (temporary)                    | **Uninstalled** between seeds, kept for re-seeding. Scopes: `write_products`, `write_orders`, `write_customers`, `write_inventory`, `write_fulfillments`, `read_locations`, `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders` |
| App `bit-concierge-seed` | An earlier seeding app                                   | Unused — delete it                                                                                                                                                                                                                                                  |
| Google AI Studio         | Gemini key, free tier                                    | Development only; production needs a paid key under a DPA                                                                                                                                                                                                           |
| Fly.io                   | `bit-concierge-web`, `bit-concierge-worker` in `fra`     | **Not created.** Config only                                                                                                                                                                                                                                        |
| Production Postgres      | Neon, Frankfurt ([ADR 0002](docs/adr/0002-datastore.md)) | Chosen; **not provisioned.** Nothing is deployed                                                                                                                                                                                                                    |
| Resend, Meta             | Escalation email; IG and WhatsApp                        | Not set up                                                                                                                                                                                                                                                          |

The production Shopify app for a real merchant is **a separate registration
under Bit68's organization**, made before any pilot. It is not the dev-org app.
See [section 7](#7-decisions-still-open).

### 2.4 State that does not live in git

| What                        | Where on the current machine                               | Keep?                                                                                                                |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `.env.local`                | repo root                                                  | **Yes** — via a password manager (section 2.2)                                                                       |
| Local Postgres              | Docker volume `bitc-pgdata`, container `bitc-pg`           | Optional. Holds the dev tenant, the indexed corpus, eval run summaries and conversations                             |
| Embedding and rerank caches | `.embed-cache/`, `.rerank-cache/`                          | Optional; created on first eval or ingest run, so absent on a fresh checkout. They save free-tier quota on eval runs |
| Shopify token cache         | `.shopify-token-cache/`                                    | **No** — expired 24-hour tokens. Delete                                                                              |
| Agent working notes         | `~/.claude/projects/-Users-jabrzmac-bit-concierge/memory/` | No — everything in them is now in `CLAUDE.md`, the runbook or section 11                                             |

Everything in the database can be regenerated — `pnpm db:seed` for the tenant,
`pnpm --filter @bitc/rag ingest` for the corpus. The one thing that could not,
the eval run history, is **already exported to the repository**
([packages/evals/history/](packages/evals/history/README.md)). Nothing in the
database needs to move.

Re-ingesting the corpus spends embedding quota; on the free tier that is a
day's planning, not a minute's.

---

## 3. Standing it up somewhere new

### On the current machine: nvm first

This repo uses nvm with `.nvmrc`. Run `nvm use` in the repo before anything
else, and do not use corepack's pnpm shims on this machine. The old shims are
what caused the `pnpm.cjs` failure described below.

### Prerequisites

- **Node 24 LTS** (`.nvmrc` says 24; CI and the Dockerfile agree)
- **pnpm 12.3.4** through corepack (the `packageManager` field pins it)
- **Docker**, for Postgres 18 + pgvector 0.8 in development
- **`gh` CLI**, authenticated to wherever the repo now lives, for `pnpm gate`
- `psql`, once, to create the local login role

On a clean machine `corepack enable` is enough: corepack 0.36 runs pnpm
12.3.4, and CI does exactly this.

**If `pnpm` fails with `Cannot find module …/pnpm/12.3.4/bin/pnpm.cjs`**, the
`pnpm` on your PATH is a shim from an old corepack. That is what happened on the
machine this was built on: `/opt/homebrew/bin/pnpm` pointed at corepack 0.18.0
left behind by a Node 18 install under `/usr/local`, and 0.18 predates pnpm
12's layout (`bin/pnpm.mjs` and a native binary, no `pnpm.cjs`). Clearing the
cache does not help. Re-pointing the shims at a current corepack does:

```bash
corepack --version        # must be 0.36 or later
corepack enable pnpm
pnpm --version            # 12.3.4
```

Also check `node --version` says 24. That machine's default `node` was 26; the
project pins 24 (`.nvmrc`, `engines`), and CI runs 24.

### Steps

```bash
git clone https://github.com/<owner>/bit-concierge.git
cd bit-concierge
corepack enable
pnpm install
docker compose up -d postgres
cp .env.example .env.local        # then fill the values in, out of band
```

Point both database URLs at the container for local work:

```
DATABASE_URL_MIGRATOR=postgres://postgres:postgres@localhost:55432/bitconcierge
DATABASE_URL=postgres://bitc_app_local:localdev@localhost:55432/bitconcierge
```

Then:

```bash
pnpm db:migrate
psql "$DATABASE_URL_MIGRATOR" -f packages/db/scripts/bootstrap-local.sql
pnpm verify
```

`pnpm verify` is lint, typecheck, format and the full suite — exactly what CI
runs, and a test fails if the two ever diverge. The suite owns its own database
(`bitconcierge_test`) and never touches the one in `DATABASE_URL`.

### Proving the move worked

```bash
pnpm verify:clean     # fresh clone, fresh HOME, fresh Postgres volume
pnpm gate             # CI green for the exact commit at HEAD
```

Then, with credentials in place:

```bash
pnpm db:seed
pnpm --filter @bitc/cli chat -- --debug                 # talk to it
pnpm --filter @bitc/shopify run compare:store           # the store still matches the mock
```

`compare:store` exits 0 when the store matches the mock; anything else it
prints is a real difference.

---

## 4. Where things are

```
apps/web          widget chat API (HMAC-signed sessions, SSE progress); embedded admin later
apps/widget       Shadow DOM storefront widget
apps/cli          conversation harness — the fastest way to talk to the agent
apps/worker       pg-boss consumer — a stub

packages/core     env, redacting logger, errors, AES-256-GCM key ring
packages/db       Drizzle schema, hand-written migrations, RLS, withTenant()
packages/models   chat / embedding / reranker providers behind one registry
packages/agent    the tool loop, six tools, both grounding gates, the system prompt
packages/rag      ingestion, chunking, hybrid retrieval
packages/shopify  read-only store interface: the mock, the real client, the seed scripts
packages/evals    golden set (104 cases as of the last commit, re-verify), runner, adjudications, cost scripts
packages/channels message envelope for IG/WhatsApp — a stub

test/             repo-wide guards: secrets, CI parity, provenance, seed-token isolation
docs/             ADRs, runbook, plans, findings
```

### Read in this order

1. [docs/where-this-stands.md](docs/where-this-stands.md) — what is proven, what is provisional, what was found
2. [docs/adr/0005-grounding.md](docs/adr/0005-grounding.md) and [0011](docs/adr/0011-the-bar.md) — the gate and the guarantee
3. [docs/adr/0003-multi-tenancy.md](docs/adr/0003-multi-tenancy.md) — tenant isolation, the claim licensing depends on
4. [docs/runbook.md](docs/runbook.md) — how to operate it, and the standing policies
5. [docs/phase-4-plan.md](docs/phase-4-plan.md) — the current phase, its mutation results, and what Shopify's docs say
6. [docs/agreement-inputs.md](docs/agreement-inputs.md) — every input to the 1886 agreement, with eight open gaps
7. [docs/shopify-dev-store.md](docs/shopify-dev-store.md) — the seed spec, and why order numbers cannot be chosen

All eleven ADRs are in [docs/adr/](docs/adr/).

---

## 5. The rules that do not bend

These came from the project's owner and were written down because each one was
broken at least once, or nearly. They travel with the code.

### Data and secrets

- **Never write a secret into a file that is not `.env.local`.** No API keys in
  source, config, tests, comments or commit messages. `.env.example` holds names
  only. `test/secrets.test.ts` scans every tracked file.
- **Development uses synthetic data only.** Real customer records go through a
  paid model key under a data-processing agreement — never the free tier.
- **Nothing touches a real merchant store until there is a signed agreement.**
  The development store is the only Shopify that exists until then.
- **Corpus fetches are public pages only, no customer data.** No inbox exports
  in the golden set until an agreement covers them.
- **Never click past GitHub secret scanning.** Fix the fixture instead. Test
  fixtures that look like credentials are written so they cannot be one.
- **The agent's app is read-only.** The runtime never reads the seeding
  credentials; a test fails if any runtime file names them, and the guard
  refuses their values.
- **Merchant-authored message copy is not gated.** It is the merchant's business
  speaking in its own words; responsibility for it belongs in the agreement.
- **Supply-chain policy is not relaxed to make something pass.**

### Working practice

- **Plan before building. Stop at every phase boundary** for review.
- **Ask, do not assume.** A decision that is the owner's — a payment state, a
  scope, a schema shape — is put to them, not defaulted.
- **Verify current versions and current docs** rather than recalling them.
- **Commit at every logical unit**, and **only on `verify`'s own exit status**:

  ```bash
  pnpm verify > /tmp/verify.log 2>&1 && git commit -m "..."
  ```

  Never pipe `verify` into `grep` before `&&` — a pipeline's status is the last
  command's. Never run verify and commit in the same block without the `&&`.

- **Every background wait has a timeout.** A `while true` once ran 155 hours.
- **If you find yourself writing a workaround for something specified, stop and
  say the spec is wrong.** When a step fails, stop and report; do not work
  around it.
- **Mutation-test every security- or correctness-critical component before its
  gate closes**, and record the results in the gate report. A suite that stays
  green when a control is removed was testing nothing.
- **One eval run per day, and nothing else touches the model key that day.** The
  free tier fits one 103-case run with about 28% headroom.
- **`compare:store` runs after every seed.** The `@bitc/shopify` `seed` script runs it for you.

---

## 6. Operating it

| Task                       | Command                                                                                                                          | Read first                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Talk to the agent          | `pnpm --filter @bitc/cli chat -- --debug`                                                                                        | [README](README.md#talking-to-it)                               |
| Run the golden set         | `pnpm evals run -- --suite en-core --out packages/evals/history/<date>-run.md --out-json packages/evals/history/<date>-run.json` | [runbook](docs/runbook.md#running-an-eval-suite)                |
| Check recorded absences    | `pnpm --filter @bitc/evals run verify-absence`                                                                                   | before any gate                                                 |
| Ingest a storefront        | `pnpm --filter @bitc/rag ingest`                                                                                                 | spends embedding quota                                          |
| Seed the dev store         | `seed:check` → `seed:dry-run` → `seed` (in `@bitc/shopify`)                                                                      | [runbook](docs/runbook.md#seeding-the-development-store)        |
| Compare store against mock | `pnpm --filter @bitc/shopify run compare:store`                                                                                  | exits non-zero on any unexplained difference                    |
| Close a phase              | `pnpm verify:clean`, then `pnpm gate`                                                                                            | [runbook](docs/runbook.md#closing-a-phase)                      |
| Swap the chat model        | registry, run, diff, review suppressions                                                                                         | [runbook](docs/runbook.md#swapping-the-chat-model)              |
| Re-index to a new embedder | backfill, then flip config                                                                                                       | [runbook](docs/runbook.md#re-indexing-to-a-new-embedding-model) |

**Output paths:** `--out` and `--out-json` start at the repository root, whatever
the working directory, and the directory must exist; a missing one fails before
the run spends any quota. (Until 2026-10-12 they started at `packages/evals/`,
so the documented command wrote to `packages/evals/packages/evals/history/`.)

**Reading an eval report:** check `incompleteCases` before any other number. A
run that runs out of quota or times out does not fail loudly; it scores the
remaining cases as failures and understates everything.

---

## 7. Decisions still open

| Decision                                                                                                                                | Whose                               | Source                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| How the agent gets Shopify credentials at runtime                                                                                       | Owner — conditionally decided       | [phase-4-plan.md](docs/phase-4-plan.md#the-decision-the-wiring-needs--what-shopifys-docs-say)              |
| Custom distribution per merchant, or a public app — **cannot be changed once chosen**                                                   | Bit68                               | same                                                                                                       |
| 1886's payment capture mode (automatic or manual)                                                                                       | Confirm in 1886's admin             | [where-this-stands.md](docs/where-this-stands.md#1886s-capture-mode-is-unverified)                         |
| Requesting `read_all_orders` (older than 60 days)                                                                                       | Bit68 with 1886, in the agreement   | [where-this-stands.md](docs/where-this-stands.md#a-pilot-limitation-with-a-name-orders-older-than-60-days) |
| Who at 1886 signs the golden set                                                                                                        | 1886                                | [ADR 0011](docs/adr/0011-the-bar.md)                                                                       |
| Cross-border transfer to Frankfurt under PDPL, sub-processors, offboarding, embeddings on termination, backup retention                 | Bit68 and counsel                   | [agreement-inputs.md](docs/agreement-inputs.md) — the eight lines marked GAP                               |
| Which behaviour the four unstable cases should have                                                                                     | 1886, through a signed question set | [where-this-stands.md](docs/where-this-stands.md#the-quality-problem-isolated)                             |
| What to tell a customer about an expired authorization, and about eight carrier states (delayed, attempted delivery, ready for pickup…) | Owner                               | [map.ts](packages/shopify/src/admin/map.ts) — each hands over until decided                                |

On credentials, Shopify's docs settle the facts: client credentials only work
when the app and the store share an organization, so a merchant's store is
reached through custom distribution and the authorization code grant, which
yields a per-store offline token — the shape `shopify_installs` already stores.
The owner's decision is to keep that schema and treat client credentials as a
development, same-organization source read from the environment. **Not built.**

---

## 8. What to do next, in order

1. ~~Push and confirm.~~ Done 2026-10-11; CI green.
2. **Transfer the repository** to Bit68's organization if that is the move;
   update the remote; keep push protection on.
3. **Re-seed the development store.** Install `bitc-seed` on the dev store, then:
   - scenario 1 gets an in-transit carrier event (`carrierStatus: 'IN_TRANSIT'`
     in `seed-data.ts`);
   - add scenario 7, an **authorized** order, and scenario 8, a **partially
     paid** one — the seed mechanism for both is built and checked by
     `seed:check`; the data is not added yet, because their order numbers are
     assigned by the store. The data proposed for them, never written down
     until now:

     | Scenario          | Customer (new)       | City   | Line             | Payment                                          |
     | ----------------- | -------------------- | ------ | ---------------- | ------------------------------------------------ |
     | 7. Authorized     | `yousef@example.com` | Riyadh | `TFMC-BLUE-L` ×1 | `{ status: 'AUTHORIZED' }`                       |
     | 8. Partially paid | `reem@example.com`   | Jeddah | `JP-ECRU-S` ×1   | `{ status: 'PARTIALLY_PAID', amount: '100.00' }` |

     Both unfulfilled on purpose: fulfilling an authorized order may make
     Shopify capture it, depending on store settings, which would quietly turn
     scenario 7 into scenario 1. Expect `#1886-1008` and `#1886-1009`, and
     **record what the store actually assigns** — the last batch had a gap;

   - `seed:check`, `seed:dry-run`, `seed` — which runs `compare:store`;
   - record the assigned numbers in `ASSIGNED_ORDER_NUMBERS`, mirror the new
     orders in `packages/shopify/src/mock/fixtures.ts`, refresh the recorded
     shapes in `packages/shopify/test/shapes.ts`;
   - write four golden cases: in transit, an authorized order's status, an
     authorized order's payment question (escalate, `escalationGround: 'money'`),
     and a partially paid order (escalate, `'money'`). `mustNotContain` is a
     substring check — `"delivered"` matches "not delivered yet" and `"in stock"`
     matches "not in stock", so pick phrases a correct reply cannot contain.
     `suite.test.ts` fails if an order number is not in the fixtures or an
     email cannot verify, so mirror the orders first;
   - when `compare:store` exits 0, **uninstall `bitc-seed` again.**
4. **Run the eval suite once** to re-baseline after Phase 4's prompt, tool and
   case changes, and record a baseline — none exists on disk. Write
   `--out`/`--out-json` into `packages/evals/history/` and commit them: the
   per-case files from every earlier run were lost because they were written to
   a temporary directory.
5. **Wire the real client into a turn**, from environment credentials, for the
   dev store. Then meet the first two Phase 4 definition-of-done items end to end:
   a real order answered with the literal gate passing on Admin API figures, and
   the different-email and guest cases through the agent. Where to start:
   - three places construct `MockShopifyClient` today —
     `apps/cli/src/chat.ts`, `apps/web/src/server.ts`, `packages/evals/src/cli.ts`;
   - `packages/shopify/scripts/compare-store.ts` already builds the real client
     from `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_RUNTIME_CLIENT_ID`/`_SECRET`:
     `AccessTokenCache` → `AdminTransport` (API version `2026-07`) →
     `ShopifyAdminClient`. That construction, behind one factory that falls back
     to the mock when the variables are absent, is most of the work;
   - credentials are arguments in `packages/shopify/src`, never `process.env`
     reads — the factory belongs at the app edge;
   - the eval suite stays on the mock. It is free and deterministic; the real
     client is checked by `compare:store` and by the definition-of-done turns.
6. **Webhooks for incremental ingest** (`apps/worker` is where they go).
7. **Escalation email delivery.**
8. **Close Phase 4:** `verify:clean`, `gate`, and a gate report carrying the
   mutation table from the phase plan. Then stop for review.

**While step 3 waits on the seed app,** steps 5, 6 and 7 do not depend on it
and can go first. Step 4 can too, but a baseline taken before step 3 will not
include the four new cases.

Carried to **Phase 5**: Arabic; a golden set validated and signed by 1886; the
four unstable cases; latency (p95 8–9s, two cases over a 45-second budget);
merchant-configurable backorder phrasing.

Carried to **Phase 6**: production deployment (a real `apps/web` build, the
worker), the production Shopify app and OAuth install flow, the embedded admin
UI, provenance for configured facts, an ingestion allowlist by path, the
retention job, escalation digests, Instagram and WhatsApp.

---

## 9. Traps this project has already fallen into

Each of these cost real time once. They recur in new forms.

- **Failure reported inside a successful response.** Shopify reports
  throttling as HTTP 200; the model reports a truncated reply as a successful
  generation; a reranker scored only some candidates and counted success. Treat
  any "success" that carries less than it should as a failure.
- **A test that passes vacuously.** The mock had diverged from the store, so the
  identity cases could have been green while asking nothing. A session token
  was "checked" by shape, so removing the check changed no test. Mutation
  testing found both.
- **What the store was asked for is not what it does.** Four divergences were
  found only by reading the store back: FULFILLED rather than IN_TRANSIT, a null
  variant title, a second total after a refund, descriptions with their line
  breaks stripped.
- **"Exists" is not "correct".** Re-running the seed skipped products with no
  stock, an order with no fulfilment, and copy written wrong. Seeding now
  reconciles rather than skips.
- **Customer text is data, every time.** A storefront's `agents.md` addressed
  to the agent, and a customer typing `status:draft` into a Shopify query, both
  arrive through channels the product exists to accept.
- **A fixture read as a fact.** Fifteen of fifteen drafted fixture facts were
  wrong ([docs/fixtures.md](docs/fixtures.md)). Five "the corpus doesn't say
  this" expectations were wrong; absences are now checked against the index,
  not believed.
- **Quoting a number before it means anything.** A 95% bar turned out to be
  unmeasurable — a perfect system clears it 38.7% of the time. It was retired
  for a property ([ADR 0011](docs/adr/0011-the-bar.md)).

---

## 10. Ownership

- **IP:** Bit68 (Cairo). Licensed per store.
- **First tenant:** 1886 (1886riyadh.com) — a design partner, with no agreement
  signed yet.
- **Project owner:** the Bit68 owner who commissioned and reviewed this build;
  every decision recorded as "the owner's" in the docs is theirs.

### Owner and contacts

- **Owner:** Karim Gabr, Technical PM, Bit68 —
  [karim.gabr@bit68.com](mailto:karim.gabr@bit68.com).
- **Shopify:** the development store and both apps live in a personal Partner
  org, `bit-concierge-dev`, owned by Karim Gabr. The Bit68 Partner org admin is
  **to confirm**; it is not known.
- **Timeline:** there is no deadline yet for the 1886 agreement or for the
  distribution decision.

---

## 11. What only the builder knew

Written in before the move, because the agent that built this kept working notes
outside the repository and they do not travel. Everything below was true on
2026-10-11.

### How the owner works

- **Every phase ends at a checkpoint, and work stops there** until the owner
  approves it in writing. Approvals arrive as a message that starts "Phase N
  approved" and usually carries decisions; record those decisions in the docs,
  dated, in the owner's words where they gave words.
- **Report what failed first, and plainly.** A failing test, a skipped step, a
  number that went the wrong way. The owner reads closely and has caught
  overstatement every time it happened.
- **Never claim an improvement that was not measured.** A metric that improved
  because the measurement changed is not an improvement in the system; the owner
  called one such claim "technically true and substantively false", and the
  refusal to make it was "the single most important line in the report".
- **Keep a property apart from a count.** "A fabricated literal reaching a
  customer is a property. A count of gate interventions is not." The owner
  repeats this; so should every report.
- **When you were wrong, correct it with a measurement, briefly**, and carry on.
- **Decisions that are the owner's are put to the owner**: payment states,
  scopes, schema shape, what a customer is told in a state nobody has designed
  copy for. The answer is recorded where the code that implements it can point.

### Decisions, with dates

| Date       | Decision                                                                                            | Recorded in                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 2026-09-16 | The 95% accuracy bar is retired for a property: zero fabricated literals, zero uncited claims       | [ADR 0011](docs/adr/0011-the-bar.md)                                                                       |
| Phase 3    | Replies do not stream; not to be revisited under UX pressure                                        | [ADR 0010](docs/adr/0010-no-streaming.md)                                                                  |
| Phase 3    | The four unstable cases are carried to Phase 5, not fixed in Phase 4                                | [phase-4-plan.md](docs/phase-4-plan.md)                                                                    |
| Phase 3    | Merchant-authored copy is not gated; responsibility goes in the agreement                           | [ADR 0005](docs/adr/0005-grounding.md)                                                                     |
| 2026-09-21 | Zero stock that still sells: "can be ordered, not in stock, can't say when it ships", then a person | [where-this-stands.md](docs/where-this-stands.md#a-suite-that-only-ever-saw-the-mock)                      |
| 2026-09-21 | Do not request `read_all_orders`; it goes in the design-partner agreement                           | [where-this-stands.md](docs/where-this-stands.md#a-pilot-limitation-with-a-name-orders-older-than-60-days) |
| 2026-09-24 | Authorized → treat as confirmed, payment questions handed over; partially paid → always handed over | [where-this-stands.md](docs/where-this-stands.md#1886s-capture-mode-is-unverified)                         |
| 2026-09-24 | Keep `shopify_installs`; client credentials are a dev and same-org source read from env             | [phase-4-plan.md](docs/phase-4-plan.md#the-decision-the-wiring-needs--what-shopifys-docs-say)              |
| 2026-10-18 | Product descriptions: "Keep descriptionHtml" — the client converts `descriptionHtml`; no flattening | [CLAUDE.md](CLAUDE.md), `packages/shopify/src/admin/html.ts`                                               |

### Facts not written anywhere else

- **The seed script reads products with `productByHandle`, which is
  deprecated.** It works at 2026-07, and it is invisible to default
  introspection, which is why `seed:check` never flagged it. When Shopify
  removes it, seeding breaks loudly. The read client already uses
  `products(query: "handle:…")`; move the seed to the same.
- **Shopify's OAuth errors, as observed against this store:** an app that was
  never installed answers `invalid_request` without checking the secret at all;
  an app that was installed and then removed answers `app_not_installed`; a
  wrong secret on an installed app answers `invalid_client`. Only the last
  proves the ID and secret belong to different apps.
- **Scripted text edits fail silently after Prettier has reflowed a file.** A
  find-and-replace whose search text no longer matches does nothing and reports
  nothing. Assert the match before writing, every time.
- **Temporary directories do not survive a reboot.** The per-case eval files
  were lost that way. Anything that is evidence goes in the repository.
- **Docker Desktop does not start on its own after a reboot** on the build
  machine; the tests need the `bitc-pg` container on port 55432.

When something here is wrong, fix this file in the same commit as the change
that made it wrong.
