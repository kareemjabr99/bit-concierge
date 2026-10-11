# Bit Concierge — Handover

Written 2026-10-11 to move this project to another place: another machine,
another team, or Bit68's GitHub organization. It says what the project is,
**exactly where it stands**, what has to move with it, how to stand it up again,
and what to do next.

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
  scenarios (in transit, unshipped, delivered, different email on the order,
  partial refund, guest checkout), verified by reading them back.
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

### Numbers, and what they are worth

| Measure                                   | Value                                    | Worth quoting?                                      |
| ----------------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| Fabricated literals reaching a customer   | 0                                        | **Yes** — a property, enforced by the gate          |
| Uncited policy claims reaching a customer | 0                                        | **Yes** — same                                      |
| Accuracy                                  | ~79% on 103 cases, ±3.3 points           | No — drafted suite, not client-validated            |
| Deflection                                | 77.5%                                    | No — same; this is the number that would sell it    |
| Escalation precision                      | 73.8%                                    | No — same                                           |
| Latency                                   | 3.2s median, 8.1s p95, 33s worst         | Yes, and it is a known weakness                     |
| Model cost                                | $4.70 per 1,000 three-turn conversations | Yes, at Google's published paid rate                |
| Platform floor                            | ~$53/month shared, before any tenant     | Yes — price with a floor, not only per conversation |
| Tests                                     | 691 passing, 39 files                    | —                                                   |

**Every eval number above predates Phase 4's changes.** Since the last run the
system prompt gained a stock section and a payment rule, `lookup_order`'s output
changed, the golden set was remapped to new order numbers, and a 104th case was
added. Nothing has been re-measured. **The next eval run re-baselines
everything** — see [step 4 of what to do next](#8-what-to-do-next-in-order).

**No baseline is recorded on disk** (`packages/evals/baselines/` is empty). Eval
run history lives in the `eval_runs` table of the local development database,
not in git — see [what does not live in git](#24-state-that-does-not-live-in-git).

### Blocked right now

| Blocker                                                                                           | Who                            | Unblock                                                                     |
| ------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| **3 commits not pushed.** The active GitHub CLI account is `karimgabr-PM`, which has READ only.   | Repo owner                     | `gh auth switch --user kareemjabr99`, then `git push origin main`           |
| **Seed app not installed.** Shopify returns `app_not_installed` for `bitc-seed` on the dev store. | Shopify org admin              | Install `bitc-seed` on the dev store specifically; `seed:diagnose` confirms |
| **`compare:store` exits 1** — three product descriptions lost their line breaks in the store.     | Fixed in code; needs a re-seed | Re-seed (needs the line above)                                              |

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

- **Push the three local commits first** (`1adc6c2`, `734a68e`, `f1fc3a9`, plus
  the commit adding this file). A transfer of the remote without them leaves the
  payment-state work, the seed refactor and the agreement inputs behind.
- **CI needs no secrets.** It runs against a throwaway Postgres service, so it
  works in a new organization as-is. `pnpm gate` reads CI status through the
  `gh` CLI, so the new owner's `gh` must be authenticated to the new location.
- GitHub **push protection** is relied on. Keep it on in the new organization.

### 2.2 Secrets

Secrets live **only** in `.env.local`, which is gitignored. They never go in a
file that is not `.env.local`, never in chat, never in a commit message. Move
them through a password manager or another channel built for it.

`.env.example` holds every **name** and no value. The ones in use today:

| Variable                                            | What it is                                      | Notes                                                         |
| --------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`, `DATABASE_URL_MIGRATOR`             | App role (RLS enforced) and migration role      | Local values are in the README                                |
| `ENCRYPTION_KEY`, `_VERSION`, `_PREVIOUS`           | AES-256-GCM key ring for credentials at rest    | No production data is sealed with it yet                      |
| `BLIND_INDEX_SALT`                                  | Salts blind indexes of order numbers and IPs    | Required in production                                        |
| `GOOGLE_GENERATIVE_AI_API_KEY`                      | Gemini, **free tier**                           | Free-tier prompts train Google's models — synthetic data only |
| `SHOPIFY_STORE_DOMAIN`                              | The development store                           | `bit-concierge-dev-blb8x6ix.myshopify.com`                    |
| `SHOPIFY_RUNTIME_CLIENT_ID`, `_SECRET`              | The read-only runtime app (`bit-concierge`)     | Seven read scopes; installed on the dev store                 |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`        | The **seeding** app (`bitc-seed`), write scopes | Never read by the runtime — a test enforces it                |
| `SHOPIFY_API_KEY`, `_SECRET`, `_APP_URL`, `_SCOPES` | Reserved for the embedded admin app             | Phase 6; confirm which app they belong to before using        |
| `RESEND_API_KEY`, `ESCALATION_FROM_EMAIL`           | Escalation email                                | Not wired yet                                                 |
| `META_*`, `INSTAGRAM_*`, `WHATSAPP_*`               | Channels                                        | Phase 6                                                       |

**Rotate when ownership changes.** If this moves to people who should not hold
the current credentials: regenerate the Google key and both Shopify client
secrets in their dashboards. Rotating `ENCRYPTION_KEY` is cheap today because
nothing real is sealed with it; it will not be cheap later.

The seed app's credentials carry write scopes. The guard
(`packages/shopify/src/admin/guard.ts`) refuses them **by value** anywhere a
runtime access token is expected, so a value pasted into the wrong variable
fails loudly rather than giving the agent write access.

### 2.3 External accounts

| Resource                 | Where                                                    | State                                                      |
| ------------------------ | -------------------------------------------------------- | ---------------------------------------------------------- |
| GitHub repository        | `kareemjabr99/bit-concierge`                             | Private; transfer to Bit68 pending                         |
| Shopify development org  | Dev Dashboard, Bit68's development organization          | Holds the dev store and both apps                          |
| Development store        | `bit-concierge-dev-blb8x6ix.myshopify.com`               | Dev type, Basic plan, SAR, Riyadh, order prefix `1886-`    |
| App `bit-concierge`      | Read-only runtime app                                    | Installed; seven read scopes                               |
| App `bitc-seed`          | Seeding app, write scopes                                | **Uninstalled** between seeds, kept for re-seeding         |
| App `bit-concierge-seed` | An earlier seeding app                                   | Unused — delete it                                         |
| Google AI Studio         | Gemini key, free tier                                    | Development only; production needs a paid key under a DPA  |
| Fly.io                   | `bit-concierge-web`, `bit-concierge-worker` in `fra`     | **Not created.** Config only                               |
| Production Postgres      | Neon, Frankfurt ([ADR 0002](docs/adr/0002-datastore.md)) | Chosen; nothing in the repo shows it provisioned — confirm |
| Resend, Meta             | Escalation email; IG and WhatsApp                        | Not set up                                                 |

The production Shopify app for a real merchant is **a separate registration
under Bit68's organization**, made before any pilot. It is not the dev-org app.
See [section 7](#7-decisions-still-open).

### 2.4 State that does not live in git

| What                        | Where on the current machine                               | Keep?                                                                                  |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `.env.local`                | repo root                                                  | **Yes** — via a password manager (section 2.2)                                         |
| Local Postgres              | Docker volume `bitc-pgdata`, container `bitc-pg`           | Optional. Holds the dev tenant, the indexed corpus, eval run history and conversations |
| Embedding and rerank caches | `.embed-cache/`, `.rerank-cache/`                          | Optional; they save free-tier quota on eval runs                                       |
| Shopify token cache         | `.shopify-token-cache/`                                    | **No** — expired 24-hour tokens. Delete                                                |
| Agent working notes         | `~/.claude/projects/-Users-jabrzmac-bit-concierge/memory/` | No — both rules in it are also in `docs/runbook.md`                                    |

Everything in the database can be regenerated — `pnpm db:seed` for the tenant,
`pnpm --filter @bitc/rag ingest` for the corpus — except **eval run history**.
If that history matters, export it before the move:

```bash
docker exec bitc-pg pg_dump -U postgres -d bitconcierge -t eval_runs > eval_runs.sql
```

Re-ingesting the corpus spends embedding quota; on the free tier that is a
day's planning, not a minute's.

---

## 3. Standing it up somewhere new

### Prerequisites

- **Node 24 LTS** (`.nvmrc` says 24; CI and the Dockerfile agree)
- **pnpm 12.3.4** through corepack (the `packageManager` field pins it)
- **Docker**, for Postgres 18 + pgvector 0.8 in development
- **`gh` CLI**, authenticated to wherever the repo now lives, for `pnpm gate`
- `psql`, once, to create the local login role

On the machine this was built on, corepack's cached pnpm 12.3.4 lost its binary
and would not re-download, so the build ran on a standalone Node with tools
called from `node_modules/.bin`. On a clean machine `corepack enable` is enough;
if it is not, fix corepack rather than working around it.

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

`compare:store` will exit 1 on three product descriptions until the store is
re-seeded. That is expected, and it says why in its output.

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
packages/evals    golden set (104 cases), runner, adjudications, cost scripts
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
- **`compare:store` runs after every seed.** `pnpm seed` runs it for you.

---

## 6. Operating it

| Task                       | Command                                                              | Read first                                                      |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| Talk to the agent          | `pnpm --filter @bitc/cli chat -- --debug`                            | [README](README.md#talking-to-it)                               |
| Run the golden set         | `pnpm evals run -- --suite en-core --out run.md --out-json run.json` | [runbook](docs/runbook.md#running-an-eval-suite)                |
| Check recorded absences    | `pnpm --filter @bitc/evals run verify-absence`                       | before any gate                                                 |
| Ingest a storefront        | `pnpm --filter @bitc/rag ingest`                                     | spends embedding quota                                          |
| Seed the dev store         | `seed:check` → `seed:dry-run` → `seed` (in `@bitc/shopify`)          | [runbook](docs/runbook.md#seeding-the-development-store)        |
| Compare store against mock | `pnpm --filter @bitc/shopify run compare:store`                      | exits non-zero on any unexplained difference                    |
| Close a phase              | `pnpm verify:clean`, then `pnpm gate`                                | [runbook](docs/runbook.md#closing-a-phase)                      |
| Swap the chat model        | registry, run, diff, review suppressions                             | [runbook](docs/runbook.md#swapping-the-chat-model)              |
| Re-index to a new embedder | backfill, then flip config                                           | [runbook](docs/runbook.md#re-indexing-to-a-new-embedding-model) |

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

1. **Push and confirm.** Switch the `gh` account, push the four local commits,
   run `pnpm gate`.
2. **Transfer the repository** to Bit68's organization if that is the move;
   update the remote; keep push protection on.
3. **Re-seed the development store.** Install `bitc-seed` on the dev store, then:
   - scenario 1 gets an in-transit carrier event (`carrierStatus: 'IN_TRANSIT'`
     in `seed-data.ts`);
   - add scenario 7, an **authorized** order, and scenario 8, a **partially
     paid** one — the seed mechanism for both is built and checked by
     `seed:check`; the data is not added yet, because their order numbers are
     assigned by the store;
   - `seed:check`, `seed:dry-run`, `seed` — which runs `compare:store`;
   - record the assigned numbers in `ASSIGNED_ORDER_NUMBERS`, mirror the new
     orders in `packages/shopify/src/mock/fixtures.ts`, refresh the recorded
     shapes in `packages/shopify/test/shapes.ts`;
   - write four golden cases: in transit, an authorized order's status, an
     authorized order's payment question (escalate), and a partially paid order
     (escalate);
   - when `compare:store` exits 0, **uninstall `bitc-seed` again.**
4. **Run the eval suite once** to re-baseline after Phase 4's prompt, tool and
   case changes, and record a baseline — none exists on disk.
5. **Wire the real client into a turn**, from environment credentials, for the
   dev store. Then meet the first two Phase 4 definition-of-done items end to end:
   a real order answered with the literal gate passing on Admin API figures, and
   the different-email and guest cases through the agent.
6. **Webhooks for incremental ingest** (`apps/worker` is where they go).
7. **Escalation email delivery.**
8. **Close Phase 4:** `verify:clean`, `gate`, and a gate report carrying the
   mutation table from the phase plan. Then stop for review.

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

When something here is wrong, fix this file in the same commit as the change
that made it wrong.
