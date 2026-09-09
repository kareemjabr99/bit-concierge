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
