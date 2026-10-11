# Bit Concierge

Multi-tenant conversational commerce agent for Shopify stores — Bit68-owned IP,
licensed per store. Answers a merchant's customers about orders, stock and
policies. First tenant: **1886** (1886riyadh.com), a design partner with **no
signed agreement yet**.

**The rule everything follows from:** "where is my order" is a tool call, not a
retrieval. Order, price and stock facts come only from live Shopify calls;
policies come only from retrieval; a deterministic gate withholds any reply
carrying a fact no tool returned or a policy claim without a citation.

**Read [HANDOVER.md](HANDOVER.md) at the start of any substantial work.** It
says where the project stands, what is blocked and what to do next. Read
[docs/where-this-stands.md](docs/where-this-stands.md) before quoting any number.

## Where it stands — keep this section current

- Phases 0–3 closed. **Phase 4 (real Shopify) in progress**: the dev store is
  seeded with 8 order scenarios (2026-10-11), and `apps/cli` builds the real
  `ShopifyAdminClient` when the three runtime variables are set (mock only when
  none are; half-set or a refused grant throws). Different-email and guest
  cases verified through the CLI against the real store. `apps/web` and the
  eval runner still construct the mock. Nothing is deployed.
- **Open:** `compare:store` exits 1 on three product descriptions, and a
  re-seed cannot fix it — the store's `descriptionHtml` has the line breaks but
  Shopify's `description` field collapses whitespace. Needs an owner decision
  (read `descriptionHtml` in the client, or flatten the mock). `bitc-seed`
  stays installed until `compare:store` exits 0.
- **Next:** HANDOVER.md section 8: the eval re-baseline (step 4, which also
  exercises the four new golden cases — they have not met the model yet), then
  `apps/web` and the eval runner onto the factory (note: the factory mints one
  24-hour token at start; a long-running server needs refresh), webhooks,
  escalation email.
- **Needs from the owner:** the description decision above, and the decisions
  in HANDOVER.md section 7.
- Every eval number predates Phase 4. The next run re-baselines; commit its
  output to `packages/evals/history/`.

## Rules that do not bend

Data and secrets:

- **Never write a secret into a file that is not `.env.local`.** Not in source,
  config, tests, comments or commit messages. `.env.example` holds names only.
  Never ask for a secret in chat; the owner puts credentials in `.env.local`.
- **Synthetic data only in development.** The model key is free tier, and
  free-tier prompts train the provider's models. Real customer records need a
  paid key under a data-processing agreement.
- **Nothing touches a real merchant store until there is a signed agreement.**
  The development store is the only Shopify that exists.
- **Corpus fetches: public pages only, no customer data.** No inbox exports.
- **The agent is read-only.** The runtime never reads the seeding credentials
  (`SHOPIFY_CLIENT_ID`/`_SECRET`, `SHOPIFY_SEED_TOKEN`); a test fails if any
  runtime file names them, and `assertAgentAccessToken` refuses their values.
- **Never use GitHub's secret-scanning bypass URL.** Fix the fixture.
- **Do not relax the supply-chain policy to make something pass.**
- **Do not gate merchant-authored message copy.** It is the merchant's own words.
- **Never hardcode the GitHub organization path.** The repo will move.

Working practice:

- **Plan before building. Stop at every phase boundary** and wait for approval.
- **Ask, do not assume.** A choice that is the owner's goes to the owner.
- **Verify current versions and current docs**; do not recall them.
- **If you are writing a workaround for something specified, stop and say the
  spec is wrong.** When a step fails, stop and report it.
- **Commit at every logical unit, and only on verify's own exit status:**

  ```bash
  pnpm verify > /tmp/verify.log 2>&1 && git commit -m "..."
  ```

  Never pipe verify into `grep` before `&&` (a pipeline's status is the last
  command's). Never run verify and commit in one block without the `&&`.

- **Mutation-test every security- or correctness-critical component** before its
  gate closes, and record the results in the gate report.
- **Every background wait has a timeout.** No `while true` without a bound.
- **One eval run per day; nothing else touches the model key that day.**
- **Run `compare:store` after every seed** — the `@bitc/shopify` `seed` script runs it for you. (Root `pnpm db:seed` is the database tenant, not the store.)
- **Assert before a scripted text edit.** After Prettier reflows a file, a
  find-and-replace that no longer matches does nothing and says nothing.

Reporting to the owner:

- Lead with what failed. Never claim an improvement you did not measure.
- Keep a property apart from a count: "A fabricated literal reaching a customer
  is a property. A count of gate interventions is not."
- Record the owner's decisions in the docs, dated, in their words.

## Commands

```bash
pnpm verify                                    # lint, typecheck, format, tests — what CI runs
pnpm gate                                      # CI green for the exact commit at HEAD
pnpm verify:clean                              # fresh clone, HOME and DB volume — at every gate
pnpm --filter @bitc/cli chat -- --debug        # talk to the agent
pnpm evals run -- --suite en-core --out-json packages/evals/history/<date>-run.json
pnpm --filter @bitc/shopify run seed:check     # then seed:dry-run, then seed
pnpm --filter @bitc/shopify run compare:store  # live store against the mock
```

Local Postgres: `docker compose up -d postgres` (container `bitc-pg`, port
55432). Node 24, pnpm 12.3.4 via corepack — if `pnpm` errors on `pnpm.cjs`, see
HANDOVER.md section 3.

## Conventions

- TypeScript run directly by Node 24, no build step for packages; relative
  imports name the real `.ts` file.
- Tenant data only through `withTenant()`; row-level security is the isolation,
  and eslint blocks the unscoped handle outside `packages/db`.
- Applied migrations are checksummed — write a new one, never edit an old one.
- The mock store mirrors the development store row for row; change
  `packages/shopify/scripts/seed-data.ts` and the fixtures together, or
  `mock-mirrors-store.test.ts` fails.
- Repo-wide guards in `test/`: secrets, CI parity, fixture provenance,
  seed-token isolation, merchant copy, widget isolation. A red one is the point.
- Comments explain why, often with the incident that made the rule. Match that.
