# 0006 — Provider registry, and evals bound to the model that produced them

**Status:** accepted, Phase 0 (design) · implemented Phase 1–2
**Date:** 2026-09-10

## Context

Chat model, embedding model and reranker must each sit behind an interface, so
swapping providers is configuration rather than code. Development runs on a free
Gemini tier; production needs a paid key under a data-processing agreement.

## Decision

### A registry, keyed by string

`tenant_config.chat_model` holds a registry key such as
`google:gemini-3.8-flash`. `packages/models` is the only place a provider SDK is
imported. The registry maps a key to an implementation plus the metadata the
rest of the system needs: context window, maximum output, per-token pricing for
cost logging, and for embeddings the dimensions, storage column and operator
class.

`@ai-sdk/anthropic` is installed and unused. A test resolves a Claude model
through the registry, so the abstraction is exercised rather than asserted.

### Evals are void when the model changes

`eval_runs` records `chat_model`, `embedding_model` and `reranker` as columns,
not as a note.

`tenant_config.production_chat_model` records the model the ship bar must be
measured on. **When a run's `chat_model` differs from the tenant's
`production_chat_model`, the ship-bar gate fails closed** — `meets_ship_bar`
stays false regardless of every other number, and `ship_bar_notes` says why.

This is a gate, not a warning. Scoring 95% on Flash, swapping the model, and
demonstrating something never measured is the specific failure this prevents.
A model swap triggers a full re-run.

The same applies to `embedding_model`: changing it changes retrieval, so
retrieval hit rate and deflection from before the swap describe a different
system.

## Consequences

- Adding a provider means a registry entry and a pricing row. No call site
  changes.
- Pricing metadata drifts as providers reprice. It lives in one file with the
  date it was checked; a stale rate makes cost reporting wrong, not the product.
- Free-tier Gemini prompts are used for training. Phases 1–3 run on synthetic
  and development-store data only. Real customer records wait for a paid key
  under a DPA — this is a hard sequencing constraint, not a preference.
