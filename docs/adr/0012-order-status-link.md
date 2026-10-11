# 0012 — The order status link: allowed after verification, contained everywhere else

**Status:** accepted
**Date:** 2026-10-12
**Decided by:** the owner, 2026-10-12: "allowed after verification. It's the link
Shopify emails the customer anyway. But contain it."

## Context

`lookup_order` returns `status_page_url`, the order's status page. On the live
store it looks like
`https://<shop>.myshopify.com/<account id>/orders/<hash>/authenticate?key=<hex>`.
**The URL is the credential.** It opens the order — items, shipping address,
tracking — with no login. Nothing else is needed, and there is no way to revoke
one short of Shopify's own tooling.

The first CLI run against the real store put one in a reply, to a customer who
had just verified the order. That raised the question: should the agent ever say
it?

## Decision

**Yes, to the customer who verified the order, in the reply to that
verification. Nowhere else.**

Reasons for allowing it: Shopify emails the same link to the customer when the
order is placed, so a verified customer learns nothing they were not already
given; and it is the most useful answer to "where is my order" the store can
give — Shopify's own tracking page, which we would otherwise paraphrase.

Reasons it is contained rather than treated as ordinary data: a leaked order
status URL is account access for one order, to anyone who sees the string.
Logs, escalation emails, committed eval output and a stranger's session are all
places strings travel.

## Containment

| Where              | Rule                                                                                                                                                                                                                                  | Held by                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Logs               | Redacted as a secret: by shape anywhere in a string, and by field name (`statusUrl`, `status_page_url`)                                                                                                                               | `STATUS_URL` in `packages/core/src/redact.ts`; `redact.test.ts`                                                                    |
| Escalation         | Stripped when the row is written. The row is what the email is built from, so what is not in the row cannot be in the email. The team opens the order in admin by number                                                              | `escalate()`; `status-link-containment.test.ts`                                                                                    |
| Eval output        | Stripped on the way to every file, and stdout. History is committed                                                                                                                                                                   | `writeEvalFile`; `status-link-history.test.ts` also fails on any direct write in `packages/evals`, and on a link already committed |
| Unverified session | A failed lookup returns an error with no link. The literal gate compares a reply's URLs with **this turn's** tool results, so a link from an earlier verified turn, or one the model produces from nothing, is withheld and escalated | the gate; the stranger-case tests, including one whose link has no digits, so that only the URL comparison can stop it             |

Mutation-tested: removing the strip in the logger, escalation or eval writer,
narrowing the pattern, un-listing the field names, and disabling the gate's URL
comparison each fail a test. The last survived the first version of the tests,
because the mock's link contains digits that other gate rules also caught; the
test whose link has none is why it no longer survives.

## What this does not contain

- **The database.** A turn's recorded tool calls, and the reply, are stored with
  the conversation, so the link is in `messages` for any order a customer
  verified. That store is tenant-scoped (row-level security) and governed by the
  retention policy in [ADR 0007](0007-retention.md). It is where a transcript
  has to live. **Anything that later reads a transcript and sends it
  elsewhere — an escalation email that quotes the conversation, an export, an
  admin view — must strip the link with `stripStatusUrls`.** Building the email
  from the escalation row, as planned, does.
- **A customer who shares it.** Verified customers can paste their own link
  anywhere. That is theirs, as the emailed one is.
- **Revocation.** None from our side. If one leaks, the remedy is Shopify's.

## Consequences

- One definition of "a status link" (`STATUS_URL`, `stripStatusUrls`) in
  `@bitc/core`; a new place that persists or forwards text uses it rather than
  writing a second pattern.
- Any change that makes the gate compare against more than the current turn's
  tool results — for example caching results across turns — reopens the
  unverified-session rule and must re-run the containment tests first.
