# 0007 — Retention, anonymisation and hard deletion

**Status:** accepted, Phase 0 (schema) · implemented Phase 6
**Date:** 2026-09-10

## Context

Saudi PDPL applies to the pilot merchant's customer data. Retention must be
configurable per tenant, and a deletion request must be honoured.

## Decision

`tenant_config.retention_days` is one of **30, 90 or 365**, enforced by a check
constraint. Default 90.

### Expiry — anonymise, keep the exchange

At `retention_days`, PII is stripped from the transcript and the exchange is
kept for eval value: emails, phone numbers, addresses, names and order numbers
removed; `conversations.redacted_at` set. `tenant_config.anonymise_on_expiry`
turns this off for a tenant that wants outright deletion instead.

### Deletion request — hard purge

A deletion request is **not** an anonymisation. The conversation and its
messages are deleted. A tombstone row keeps `tenant_id`, `conversation_id` and
`deleted_at` — nothing else — so a later audit can distinguish deletion from
data loss.

Both paths are built. Which one satisfies a PDPL erasure request is a legal
question being confirmed separately. **Nothing in this design assumes
anonymisation is sufficient**, and the hard purge exists precisely so the answer
does not constrain the architecture.

## Scope reminders

PII does not only live in `messages`.

- `escalations.contact` carries customer contact details by design. Escalation
  emails leave our system with that PII in them; the sending arrangement needs
  covering in the merchant DPA.
- pg-boss job payloads may carry customer identifiers. They share the database
  and fall under the same rules.
- `order_lookup_attempts` stores order numbers and IPs as blind indexes —
  groupable, not readable. It is not exempt, but it is already minimised.
- Application logs carry no PII at all; `redact()` is applied on the single
  write path. Full transcripts live only in the database.

## Consequences

- The retention job runs per tenant, not globally, because the window differs.
- Anonymised conversations remain useful for evals, which is the reason the
  default is anonymise rather than delete.
- A hard purge cascades to `messages` and `escalations` through foreign keys.
  The tombstone is written in the same transaction.
