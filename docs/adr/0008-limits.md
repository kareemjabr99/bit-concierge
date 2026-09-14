# 0008 — Token caps, rate limits and escalation digests

**Status:** accepted, Phase 0 (schema) · enforced Phase 1–6
**Date:** 2026-09-10

## Decision

### Token caps

| Limit              | Default          | Column                        |
| ------------------ | ---------------- | ----------------------------- |
| Per conversation   | 60,000 tokens    | `max_tokens_per_conversation` |
| Per conversation   | 25 turns         | `max_turns_per_conversation`  |
| Per tenant per day | 5,000,000 tokens | `max_tokens_per_day`          |
| Alert threshold    | 70%              | `usage_alert_pct`             |

Whichever conversation limit is reached first ends the turn and escalates. The
daily cap is a hard stop with a graceful message, not an error.

Checked against `usage_daily` before every model call — one indexed read, which
is why the rollup exists rather than walking `messages`.

> **Before the Phase 5 demo, the demo tenant's daily cap is raised 5× by hand.**
> This is a deliberate manual step. It belongs in `docs/runbook.md` and in the
> demo script, and it must be reverted afterwards.

### Escalation rate limit and digest

`max_escalations_per_hour`, default 20, per tenant.

Above the cap, escalations are **batched into a digest, never dropped**.
`escalations.delivery_status` becomes `digested` and `digest_id` points at the
`escalation_digests` row that carried it.

An escalation storm in pilot week one floods the merchant's inbox and kills the
pilot on annoyance rather than on accuracy. Dropping escalations would lose
customer requests, which is worse. Batching does neither.

The current hourly rate is surfaced in the admin dashboard, so a merchant seeing
a digest can tell why.

### Identity-gate rate limits

Order lookups are limited per conversation and per IP. `order_lookup_attempts`
records every attempt with the order number and IP as blind indexes.

A wrong email and a nonexistent order must return **byte-identical** output.
Anything else is an order-enumeration oracle. `safeEqual` gives constant-time
comparison so response timing does not become one either.

## Consequences

- All limits are per-tenant columns with defaults, so a pilot can be tuned
  without a deploy.
- The daily cap needs a graceful message per language. It is customer-facing
  copy and belongs in the prompt template, not hardcoded.
- Digest batching means an escalation can be delayed by up to an hour. That is
  the trade being made, and the merchant should be told it exists.

## Measured: what a full eval run costs, and whether the ship bar is reachable on the free tier (Phase 2)

Asked directly, and answered from three runs rather than from the provider's
documentation.

**A 103-case run costs about 390 successful requests.**

|                                 | per case | per 103-case run |
| ------------------------------- | -------- | ---------------- |
| Agent generations               | 2.90     | 299              |
| Reranker calls (one per search) | 0.90     | 93               |
| **Total**                       | **3.80** | **392**          |

Measured, not estimated: reranker calls are counted from the recorded verdict
log, and generations from tool-call counts across the 30-case A/B arm — one
generation per tool-calling step plus the final reply.

**The free tier is 500 chat requests a day on `gemini-3.5-flash-lite`**, and
15 a minute. So:

- **One complete run fits in a day, with about 110 requests spare — 28%
  headroom.**
- **Two do not.** Nor does one run plus a 30-case re-run (≈110 requests), which
  is the shape a fix-and-recheck cycle takes.
- A 429 costs three requests, because the SDK retries twice before surfacing
  it. Near the ceiling the burn accelerates, which is why run 3 lost its last
  five cases rather than its last one.

### So: can the ship bar be measured on the free tier?

**Yes, but at one attempt per day, and only if nothing else touches the key
that day.** That is the answer in writing, now.

Three consequences worth having on record before Phase 5 rather than during it:

- **A model swap voids every recorded number and costs a fresh run.** The ship
  bar is measured on `production_chat_model`; changing it means one more day.
- **Iteration is daily, not hourly.** A failed run, a fix, and a re-check is
  three days on the free tier if each needs a complete pass. Client validation
  in Phase 5 will involve several rounds of exactly that.
- **The daily ceiling is shared with development.** Run 3 was the third run of
  the day and hit the wall at case 98; on its own it would have completed. The
  binding constraint is not the run, it is everything else that happened first.

**This is a scheduling constraint, not a blocker.** It becomes one if Phase 5
needs same-day turnaround on validation rounds, and that is the point at which
a paid key stops being an ADR 0006 data-protection requirement and becomes an
operational one as well. Costed at the Phase 4 gate.

Measured with `packages/rag/scripts/quota-probe.ts` (embeddings: a per-minute
ceiling of 100, not a daily cap) and the run artefacts themselves.
