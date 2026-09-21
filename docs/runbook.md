# Runbook

On-call reference. Written as Phase 0 lands; sections are added as the systems
they describe start existing.

## The database will not migrate

```bash
pnpm db:status
```

**"pgvector X is too old"** — migration 0001 refuses to run below 0.8.0.
Iterative index scans are not optional for us; retrieval filters `tenant_id` and
`embedding_model` on every query and silently under-returns without them. Fix
the database, not the migration. On Neon: `ALTER EXTENSION vector UPDATE;`

**"Migration NNNN was edited after it was applied"** — someone changed a
migration that has already run somewhere. Write a new migration. Do not change
the checksum.

## Queries return nothing and the data is definitely there

Almost always a missing tenant scope. `withTenant()` sets `app.tenant_id` inside
a transaction; outside one, every policy matches nothing and every query is
empty. Empty is the designed failure mode — see ADR 0003.

Check what the connection thinks it is:

```sql
SELECT current_user, bitc_current_tenant();
```

If `current_user` is the migrator or a superuser, RLS is not applying at all and
the application is misconfigured. `assertAppRole()` should have caught this at
boot.

## The worker is not draining the queue

The worker must never scale to zero — a suspended worker looks exactly like
ingestion silently not working. Check `fly status -a bit-concierge-worker`
before looking at pg-boss.

## A tenant has hit its daily token cap

Expected behaviour: a graceful message, not an error. Raise
`tenant_config.max_tokens_per_day` for that tenant. No deploy needed.

> **Before a demo:** the demo tenant's daily cap is raised 5× by hand, and
> **reverted afterwards**. This is deliberate and is not automated. See ADR 0008.

## The merchant is getting escalation digests instead of individual emails

The tenant is above `max_escalations_per_hour` (default 20). Nothing was
dropped — every escalation is in the digest, with `delivery_status = 'digested'`.
Either the cap is too low for their volume or something upstream is
over-escalating. Check the escalation rate in the dashboard before raising it.

## A reply was suppressed

The grounding gate found a fact with no source, or a policy claim with no
resolvable chunk id. The verdict is on `messages.grounding`. A rising
suppression rate means the prompt or retrieval has degraded — it is a signal
worth alerting on, not noise to filter. See ADR 0005.

---

## Re-indexing to a new embedding model

Changing the embedding model changes the vector dimension family, so it is a
backfill and a cutover rather than an edit. New vectors are written beside the
old ones and nothing is removed until you say so.

**This is a command, not a queue job** — deliberately, for now. A swap has a
verification step in the middle, so a person runs each half and reads the
output between them. Wiring it to pg-boss is Phase 4 work, when webhook-driven
ingestion needs the worker anyway.

```bash
# 1. What exists today
pnpm --filter @bitc/rag reindex -- --status

# 2. Backfill the new model. Nothing customer-facing changes.
pnpm --filter @bitc/rag reindex -- --to google:the-new-model@1536

# 3. Check retrieval still returns what it should, on the new model
pnpm --filter @bitc/rag probe -- --separation

# 4. Cut the tenant over
psql "$DATABASE_URL_MIGRATOR" -c \
  "UPDATE tenant_config SET embedding_model = 'google:the-new-model@1536';"

# 5. Verify again, then remove the superseded vectors
pnpm --filter @bitc/rag reindex -- --drop google:gemini-embedding-001@1536 --yes
```

`--drop` refuses to remove the model a tenant is actively using, so step 5
cannot run before step 4.

Budget the backfill against quota: the provider meters **per text embedded**,
not per HTTP call, even though it batches up to 100 texts per request. The
current corpus is 121 chunks, so a full backfill is 121 metered requests and
needs pacing. See ADR 0006.

## Quota, and what a run costs

Free tier, measured 2026-09-12: **15 chat requests a minute, 500 a day** on
`gemini-3.5-flash-lite`; embeddings metered per text at 100 a minute.

A case costs about **8.2 model calls**, so the daily budget is roughly **60
cold cases**. A full 103-case suite does not fit in one free-tier day.

```bash
# What a run will cost before you start it
pnpm --filter @bitc/rag quota-probe -- --n 140     # embeddings only
```

If a run stops with `got error` on a block of consecutive cases, that is the
daily cap, not a regression. The runner reports it as an incomplete run and
`--baseline` refuses to record one.

Caches make a re-run affordable: `.embed-cache/` and `.rerank-cache/` at the
repo root. Delete them only when you intend to pay the full cost again.

## Swapping the chat model

Assume this happens before the client demo. It is designed to cost an hour.
Nothing in the agent loop or the eval runner branches on which tier a key
belongs to — pacing and quota live in `ChatModelSpec.quota`, which only the
harness reads — so this is a registry edit and a measurement, not a rewrite.

**Before you start**, know which model the current baseline was recorded on:

```bash
ls packages/evals/baselines/
```

### 1. Put the key in place

`GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local`. Nothing else changes.

> A paid key is what allows real customer data near the model at all. On the
> free tier Google uses submitted content for training, which is why Phases 1–3
> run on synthetic and public data only. See ADR 0006.

### 2. Add the model to the registry

`packages/models/src/chat.ts`, and a pricing row in `pricing.ts` with the date
you checked the rate. A model with no pricing row reports as `unpriced`, which
is honest; a model with a stale one reports a wrong number, which is not.

Fill in `quota` from the provider's published limits. The eval runner paces
itself from it, assuming three model calls per turn.

### 3. Run the suite on the new model

```bash
pnpm evals run --suite en-core --model google:the-new-model
```

Query embeddings are cached, so this measures the chat model rather than the
embedding endpoint's variance.

### 4. Diff it against the baseline

```bash
pnpm evals diff --suite en-core --model google:the-new-model \
                --against google:gemini-3.5-flash-lite
```

**Read the case list, not the totals.** A suppressed-correct answer and a
passed fabrication move the pass count by the same amount in opposite
directions. The diff prints which cases flipped and in which direction, and
every citation-gate suppression that appeared or disappeared.

### 5. Review every suppression that appeared

This is the step that cannot be skipped. A gate that starts withholding correct
answers on a new model looks identical in the totals to one that started
catching real fabrications. For each new suppression, read
`messages.grounding.rawModelText` and decide which it was:

```sql
SELECT c.external_id, m.grounding->'literal'->'misses', m.grounding->'citations'->'misses',
       m.grounding->>'rawModelText'
FROM messages m JOIN conversations c ON c.id = m.conversation_id
WHERE c.external_id LIKE 'eval-%' AND m.grounding->>'status' = 'suppressed'
ORDER BY m.created_at DESC;
```

The first eval run produced eight "fabricated literals" and every one was the
gate withholding a correct answer — an anchored source URL, the word
"available", and the store's own name, which is a four-digit number. Assume the
gate is as likely to be wrong as the model until you have read the text.

### 6. Re-baseline, and update the tenant

```bash
pnpm evals run --suite en-core --model google:the-new-model --baseline
```

Then set both `tenant_config.chat_model` **and** `production_chat_model`. Until
`production_chat_model` matches the model a run was measured on,
`meets_ship_bar` fails closed and says why — that is deliberate, and it is what
stops a number from outliving the model that produced it.

Keep the old baseline file. It is the record of what the previous model did,
and the only way to answer "was this always like that?".

---

## Closing a phase

Run these three, in order, and put the output of the third in the gate report.

```bash
pnpm verify:clean
```

A fresh clone, a fresh `HOME`, a fresh Postgres volume, and the README's own
sequence. It closes the class of bug where the repository is green because of
something on your machine that is not in the repository.

**What it does not cover, and never did:** whether CI runs a check that
`pnpm verify` does not. That gap put two pushes red on `prettier --check`
while this command passed, because this command did not run that check.
`test/ci-parity.test.ts` closes it — the workflow is the source of truth, and a
step added to CI that `verify` cannot run fails the suite on the machine of
whoever adds it.

```bash
pnpm gate
```

Reads CI status **for the exact commit at HEAD** and exits non-zero unless every
run on it succeeded. Three states are deliberately not green: no run for this
commit, a run still in progress, and a dirty working tree. `gh run list` without
a commit filter answers "how did the last push go", which is a different
question from "is the thing I am about to sign off green".

**A phase does not close over a red pipeline.** If `pnpm gate` is red, the gate
is not open, regardless of what the eval numbers say.

```bash
pnpm gate --report
```

Prints the status line and always exits 0. **This line goes in every gate
report, green or red.** A red pipeline stayed red for three days because nothing
carried that fact to anyone who would act on it; the fix is not vigilance, it is
putting the status in a document someone is already reading.

---

## Running an eval suite

**One eval run per day. Nothing else touches the model key on a run day.**

That is the whole operational rule, and it follows from arithmetic in ADR 0008:
a 103-case run costs about 392 chat requests, the free tier allows 500 a day,
and a 429 costs three requests because the SDK retries twice. One run fits with
about 28% headroom. Two do not. Neither does one run plus the 30-case re-check
that a fix-and-verify cycle needs.

What "nothing else" covers, because all three have already eaten a run:

- no second suite run, not even `--only` on a handful of cases
- no `probe.ts`, no `quota-probe.ts`, no ad-hoc script against the chat model
- no re-run after a fix — that is tomorrow

A run that exhausts the quota does not fail loudly. It returns `error` for
every remaining case, and those score as failures. Run 3 lost its last five
that way and reported an accuracy four points lower than the truth. The runner
refuses to write a baseline from an incomplete run, and `incompleteCases` is in
every report — check it before reading any other number.

```bash
pnpm evals run -- --suite en-core --out run.md --out-json run.json
```

Before a gate, also:

```bash
pnpm --filter @bitc/evals run verify-absence
```

Re-runs every recorded absence check against the live index. A case asserting
the corpus cannot answer something it has since started answering will score a
correct answer as a fabrication; this is what catches that after an ingest.
Costs no model calls.

---

## Mutation testing

**Standard, not optional.** Every security- or correctness-critical component
is mutation-tested before its gate closes, and the results go in the gate
report.

Three for three so far, and each time the ordinary tests were green:

| component                    | what a passing test suite missed                                  |
| ---------------------------- | ----------------------------------------------------------------- |
| Row-level security           | a policy that filtered without isolating                          |
| The citation gate            | exemptions a fabricated policy inherited from a real carrier name |
| The storefront session token | a client-chosen token letting two visitors share a transcript     |

The method is not elaborate. Break the thing on purpose, one property at a
time, and run the suite:

```bash
cp src/thing.ts /tmp/thing.bak
# ...apply one mutation...
npx vitest run path/to/thing.test.ts
cp /tmp/thing.bak src/thing.ts
```

What matters is what you mutate. Useful mutations invert a **security or
correctness property**, not a line of code: take the first forwarded hop
instead of the last, skip the signature check, return the raw model text, allow
any origin, remove the exemption guard. A mutation nobody would plausibly write
proves nothing.

**A surviving mutation is a finding, not a test to patch.** Twice now the
survivor meant the control itself was decorative rather than the test being
weak — the session token's shape check was never what made it safe, and
patching the test would have preserved the hole. Read a survivor as a question
about the code first.

**Two traps, both hit here.** A mutation applied by string replacement may not
match after formatting — check it actually applied before believing it
survived. And prose that repeats a marker can act as a decoy: removing the real
declaration left a copy behind in a comment, and the test passed for the wrong
reason.

---

## Reporting numbers

Two claims. They do not get merged, in a gate report or anywhere else.

**The safety claim — the bar.** Zero fabricated literals and zero uncited
policy claims reaching a customer. A property, stated as one: no percentage, no
interval, no "99.8%". Above zero means the guarantee is broken, not degraded.

**The quality claim — not established.** Deflection, accuracy, escalation
precision. Every one of these is measured against a suite the merchant has not
signed and carries a ±3.3 point interval from run-to-run nondeterminism. They
are figures, not bars, and they stay that way until Phase 5 client validation
regardless of how good they get.

The sentence to keep: **the bar proves the agent never invents a fact;
deflection proves it is worth paying for; only the first one currently holds.**

A report that puts them in one table has merged them. `reportRun` keeps them in
separate sections with that wording, and it should stay that way.

---

## Verifying anything a customer touches

**Desktop screenshots are not verification for this product.**

Written down because it cost a real defect. The widget's close button was a
29px tap target — comfortably clickable with a mouse, unpleasant with a thumb,
and invisible in every desktop screenshot taken of it. It was found by checking
the stylesheet against a 44px minimum, not by looking.

KSA storefront traffic is roughly **78% mobile**. A phone is the common case
here, not an accessibility edge case, so "it looked right" on a laptop is not
evidence about the majority of users.

What this means in practice:

- **A screenshot proves layout, not usability.** Sizes, contrast and reach need
  measuring or asserting, not eyeballing.
- **Structural checks beat visual ones where a rule exists.** `min-height: 44px`
  is testable in CI and a screenshot is not. `test/widget-isolation.test.ts`
  holds the tap targets and the 16px input font that stops Safari zooming the
  merchant's page.
- **Neither replaces a finger on glass.** Touch events, the on-screen keyboard
  moving the viewport under a focused input, and momentum scrolling inside a
  panel are not reachable from either. That verification is an open item in
  `docs/demo-script.md` and closes against a tunnel on a real phone before the
  Phase 5 demo.

The general form, which applies beyond mobile: **when a check is cheap to
automate and the failure is invisible to inspection, automate it.** The same
reasoning produced the citation gate, the CI parity test and the absence
checks.

---

## Secret scanning: we fix the fixture, we do not click past it

**Standing policy. Never use GitHub's push-protection bypass URL.**

It has already been offered once. A test fixture was `shpat_` followed by 32
hex characters — the exact shape of a real Shopify token — and both
`test/secrets.test.ts` and GitHub push protection rejected it. The value was
fake and the bypass was one click.

Using it would have taught everyone who saw the commit that push protection is
advisory. It is not, and a fixture that looks exactly like a credential is
wrong regardless of whether the credential is real: it trains the eye to skim
past token-shaped strings, and it is the same mistake as the invented shipping
rates — content indistinguishable from the real thing.

What to do instead:

- **If the commits are unpushed, rewrite them.** `git reset --soft` back to the
  last pushed commit and recommit. Costs nothing.
- **Fix the fixture structurally, not cosmetically.** The second attempt was
  `FAKE-CREDENTIAL-NOT-A-REAL-TOKEN-0001`, which still tripped the rule against
  long opaque literals assigned to secret-shaped names — correctly, because
  that is what a leaked token looks like from the outside. The fixtures now
  contain spaces and an em dash, which no token format can accommodate. The way
  to satisfy a structural rule is structurally.
- **If a real secret was committed, it is burned.** Rotate it first, then clean
  the history. Do not rely on a force-push having been fast enough.

The only case for the bypass is a false positive on content that genuinely
cannot be changed, and none has occurred. If one does, it is a conversation
rather than a click.

## Running verify before a commit

**Chain it, do not read it.**

```bash
pnpm verify && git commit -m "..."
```

`pnpm verify` is now `bash scripts/verify.sh` — **one command, one exit
status**, rather than a chain of npm scripts joined by `&&`. It became a script
because "chain it with `&&`" is a convention, and a convention is something you
can hold wrong. It was held wrong one commit after being written down.

A commit was once made over a failing test because `verify` and `git commit`
ran in the same block and the output scrolled past.

**And do not pipe it.** This looks equivalent and is not:

```bash
pnpm verify | grep -E 'Tests |error' && git commit -m "..."   # WRONG
```

A pipeline's exit status is the LAST command's. `grep` succeeds when it finds
the word "error", so a failing verify whose output contains that word makes the
`&&` pass. That is not a hypothetical — it pushed a commit that failed lint,
one commit after this section was written telling everyone to chain it.

If output needs filtering, capture first and let the exit status stand alone:

```bash
pnpm verify > /tmp/verify.log 2>&1 && git commit -m "..."
```

or `set -o pipefail` before the pipeline.

**Making verify a script does not fix this**, and it would be comfortable to
think it did. Measured on a deliberately broken repository:

| invocation                                          | exit  |
| --------------------------------------------------- | ----- |
| `bash scripts/verify.sh > /dev/null 2>&1`           | **1** |
| `bash scripts/verify.sh \| grep -E 'Tests \|error'` | **0** |

A pipeline reports its last command's status whatever is on the left. The
script removes the chain, so `&&` is now safe; the pipe is still yours to get
wrong. The general shape is the one this project keeps rediscovering: **a check
whose result passes through something that can swallow it is not a check.**
