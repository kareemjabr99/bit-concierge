# 0001 — Fly.io, single region, two apps from one image

**Status:** accepted, Phase 0 · **Date:** 2026-09-10

## Context

We need to run an embedded Shopify admin, a public chat endpoint that streams,
webhook receivers, and a queue consumer doing ingestion and embedding. The
pilot merchant is in Riyadh.

## Decision

Fly.io. Two apps — `bit-concierge-web` and `bit-concierge-worker` — built from
one Dockerfile, both pinned to `fra`.

## Why

pg-boss needs a process, not a function. Ingestion, embedding, re-indexing and
escalation are long and stateful. On a serverless platform we would drain a
Postgres queue from a cron trigger, which is a workaround for the platform
rather than a design.

One Dockerfile means the image that runs in production is the image that runs on
a laptop and in CI.

`fra` is the closest Fly region to Riyadh, roughly 70–90 ms RTT. **Fly has no
Gulf region**, and neither does any managed Postgres provider we would pick —
see ADR 0002. A single region also gives one honest answer to where data lives.

## Consequences

- No preview deployments. CI running the eval suite on every pull request is the
  substitute, and it is the check that actually matters for this product.
- Web and worker scale independently but share a build. A change to either
  rebuilds both; at this size that costs a minute.
- `apps/web` carries both the merchant-facing admin and the public chat
  endpoint. A widget traffic spike could affect the admin. Acceptable at one
  tenant; **split the chat API into its own app at roughly twenty tenants.**
- The worker never scales to zero. A suspended worker is a queue that stops
  draining, which looks like ingestion silently not working.
