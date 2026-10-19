# Phase 4 gate report — real Shopify, against a development store

**Date:** 2026-10-19. **Branch:** `phase-4-close`. **For:** the owner's review.
Work stops here until Phase 4 is approved.

## Pipeline

```text
CI_STATUS_PLACEHOLDER
```

`pnpm verify:clean` (fresh clone, fresh `HOME`, fresh Postgres volume):

```text
VERIFY_CLEAN_PLACEHOLDER
```

## What failed, first

- **Two of eight definition-of-done turns gave the customer no answer.** On the
  real store's cancelled, different-email order, the first run withheld both
  replies: the model wrote "was cancelled" with no citation, then with
  `[[c:order]]` where the tool's id is `t:order`. The gate did what ADR 0005
  says and handed both to a person. Re-asked once each, both answered with
  correct citations. Nothing false reached anyone; the cost is deflection. Two
  runs are not a rate, and this report does not give one.
- **Escalation email has never been delivered.** It is built and tested
  against a fake provider; there is no Resend account and no verified sending
  domain. "Built" here means the code and its tests, not a message in an inbox.
- **Webhooks are half of plan item 4.** The receiver verifies and queues;
  nothing consumes `product-changed`, and no store is subscribed (nothing is
  deployed, so there is no URL to subscribe). The consumer waits on a decision
  of yours, below.
- **Plan item 2 (credentials sealed in `shopify_installs`) is not built.** Per
  your decision of 2026-09-24 the environment is the development credential
  source; the installs path is first needed by a second store (Phase 6).
- **One mutant survived its first run** — because the mutant was written
  wrong: it minted a fixed token but never handed it to the transport. Rewritten
  so it did, it was killed. Recorded so the 38-of-38 below is not read as
  "every first attempt was caught".
- **Two small existing bugs found on the way, fixed:** `pnpm db:migrate` ignored
  `.env.local` (HANDOVER told people to run it after filling that file), and the
  runbook named a `pnpm db:status` that did not exist.
- **Not measured:** no eval run since the 2026-10-12 guard changes. Nothing in
  this close changes a prompt or a tool's output, which is a reason to expect no
  change in the numbers, not a measurement.

## Definition of done

| Item                                                                       | State                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Real order fetched and answered, literal gate passing on Admin API figures | **Met** — `#1886-1001`, carrier and tracking number from the store, both gates pass                                            |
| Mismatched-email and guest-checkout cases against real data                | **Met** — either address verifies the different-email order; guest verifies; wrong emails refused without confirming the order |
| A throttled request escalating, under test                                 | Met (earlier in the phase)                                                                                                     |
| The mock client still passing the full suite                               | Met — 965 tests; the eval runner on the factory with `--store mock`                                                            |
| The bar unchanged                                                          | Unchanged                                                                                                                      |

Transcripts: [docs/evidence/2026-10-19-phase-4-dod.md](evidence/2026-10-19-phase-4-dod.md).

**The property, kept apart from any count:** across the eight turns, zero
fabricated literals and zero uncited policy claims reached a customer. The two
withheld replies are gate interventions — a count, and not evidence of the
property either way.

## Built at the close

| Commit    | What                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `56542c7` | Your description decision recorded ("Keep descriptionHtml"); the Shopify blockers cleared in the docs                                                    |
| `1b8fbb0` | Token renewal: the transport takes a token source; renewal before expiry, one grant shared at expiry, one re-mint after a 401, no throttle attempt spent |
| `446b265` | `apps/web` takes its store from the factory; a repo guard fails if anything else builds the mock                                                         |
| `71c24f3` | The queue (pg-boss, migration 0008), the worker, escalation email and hourly digests                                                                     |
| `a0474e3` | The Shopify webhook receiver                                                                                                                             |
| `6b31c48` | Definition-of-done evidence                                                                                                                              |
| `0d1f23c` | Handover, runbook, plan, CLAUDE.md; the two script fixes                                                                                                 |

Choices made in the build that you may want to overrule:

- **The queue's schema.** pg-boss installs and upgrades its own tables in a
  `pgboss` schema that migration 0008 creates and lets the app role build in —
  rather than copying pg-boss's generated SQL into checksummed migrations,
  which would need a hand-written migration per pg-boss release. The app role
  still changes no shape in `public`. Job payloads carry ids only, so the queue
  holds no tenant data outside row-level security.
- **Enqueue in the row's transaction, in a savepoint.** A row is never written
  without its job; a queue that is down costs the email, never the escalation,
  and logs `escalation_enqueue_failed`. The row then stays `pending`, which is
  true.
- **The email copy** to the merchant's team is mine (plain text, reason,
  summary, contact, conversation id). It is not customer-facing; it is
  reviewable.
- **Recipients are the row's `sent_to`**, fixed when the escalation was
  written, not the tenant's current list.
- **No new packages.** pg-boss and drizzle-orm were added to two more
  workspaces at the versions already locked; Resend is one `fetch`, not its SDK.

## Mutation testing

38 mutants across the close, 38 killed; the full list, with the 25 from earlier
in the phase, is in
[phase-4-plan.md](phase-4-plan.md#mutation-results-for-the-gate-report).

| Component                  | Mutants | Killed |
| -------------------------- | ------- | ------ |
| Token renewal              | 12      | 12     |
| Store choice guard         | 1       | 1      |
| Escalation email and queue | 15      | 15     |
| Webhook receiver           | 10      | 10     |

## Decisions that are yours

1. **Approve Phase 4**, or say what is missing.
2. **Re-index on product change.** Consuming `product-changed` re-embeds a
   product on every merchant edit. On the free-tier key that competes with the
   one-model-use-per-day rule, and a bulk edit could spend a day's quota. Build
   it now (with a cap), wait for a paid key, or leave webhooks receiver-only.
3. **Resend.** An account and a verified sending domain if escalation email is
   to be seen working; Resend named as a sub-processor in the 1886 agreement
   (it receives customers' contact details).
4. **Uninstall `bitc-seed`** from the dev store. Not a decision, an action only
   you can take.

The other open decisions are unchanged — HANDOVER.md section 7.
