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
`google:gemini-3.5-flash-lite`. `packages/models` is the only place a provider SDK is
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

## The current model, and the swap that is coming

**`google:gemini-3.5-flash-lite` is the development model _and_ the current
ship-bar model.** Everything Phase 5 measures will be measured on it.

`gemini-3.8-flash` is deliberately **not in the registry**. Its free tier is
twenty requests a day; an eval run is 200–300 calls. A registry entry for a
model nobody can afford to call is an invitation to burn a day's quota by
accident, so the entry only comes back with a paid key.

**A production model swap is a known open item.** It invalidates every eval
number on record when it happens — `eval_runs` stamps `chat_model`,
`embedding_model` and `reranker` on every row precisely so that no number can
outlive the model that produced it, and `meets_ship_bar` fails closed when a
run's model differs from `tenant_config.production_chat_model`.

The swap is designed to cost an hour, not a day:

- **Nothing in the agent loop or the eval runner branches on free-tier
  behaviour.** Pacing and quota handling read `ChatModelSpec.quota`, which is
  per-model configuration consumed by the harness. The loop never sees it.
  Swapping keys is not an exercise in unpicking accommodations.
- **Every eval result is stored against a baseline per model**, and the runner
  can diff a second model against it — which cases flipped, and every
  citation-gate suppression that appeared or disappeared. A count is not the
  signal: a suppressed-correct answer and a passed-fabricated one move it the
  same way.
- **The procedure is written down** in `docs/runbook.md` while the constraints
  are fresh, not reconstructed at swap time.

## Measured free-tier ceilings

Taken from the provider's own quota errors on 2026-09-12, not from
documentation and not inferred:

|                              | limit                                              |
| ---------------------------- | -------------------------------------------------- |
| `gemini-3.5-flash-lite` chat | **15 requests/minute, 500/day**                    |
| `gemini-embedding-001`       | **100 requests/minute**, metered per text embedded |

Two things follow, and both shaped the harness.

**A cold 103-case suite does not fit in a free-tier day.** Measured: the run of
12 Sep consumed the full 500 in **61 cases — 8.2 model calls each**. A turn is
two or three loop calls plus one per retrieval for a model-backed reranker, and
then the multiplier that matters: **a 429 costs three requests, because the SDK
retries**. Under-pacing does not merely slow a run down, it triples what each
call takes out of the daily budget. Pacing is now derived from
`quota.callsPerTurn`, which is measured rather than guessed.

**So the caches are not a convenience.** Query embeddings and reranker verdicts
are both cached to disk by the harness, which removes them from every repeat
run and brings a re-run back inside the daily budget. The agent resolves both
from the registry and sees neither, so none of this survives a swap to a paid
key.

What this means for planning: **one cold full run per day, or a paid key.**
Phase 5 adds an Arabic corpus and an Arabic suite, both cold, and that is the
point at which the free tier stops being workable — which is worth knowing now
rather than during the demo build.

## Consequences

- Adding a provider means a registry entry and a pricing row. No call site
  changes.
- Pricing metadata drifts as providers reprice. It lives in one file with the
  date it was checked; a stale rate makes cost reporting wrong, not the product.
- Free-tier Gemini prompts are used for training. Phases 1–3 run on synthetic
  and development-store data only. Real customer records wait for a paid key
  under a DPA — this is a hard sequencing constraint, not a preference.
