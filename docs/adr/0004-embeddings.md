# 0004 — Vectors in their own table, 1536 dimensions

**Status:** accepted, Phase 0 · **Date:** 2026-09-10
**Supersedes:** the brief's `chunks.embedding` column

## Context

The brief puts `embedding`, `embedding_model` and `embedding_dims` on `chunks`,
so that changing embedding model cannot silently mix incompatible vectors.

Postgres cannot deliver that on one table. A `vector` column has one fixed
dimension and an index has one dimension. Per-chunk dimensions there is a
comment, not a constraint — the design permits exactly the failure it was
written to prevent.

## Decision

### Split the table

`chunks` holds content, ordinal, heading path, language, source URL and
metadata. `chunk_embeddings` holds vectors:

```
chunk_embeddings(chunk_id, tenant_id, embedding_model, embedding_dims, embedding)
PRIMARY KEY (chunk_id, embedding_model)
```

The model is part of the key. Retrieval always filters on the tenant's active
`embedding_model`, so mixing is impossible by construction rather than by
discipline.

Re-indexing writes new rows beside the old ones. Cutover is one config flip per
tenant. Superseded rows are deleted afterwards. No downtime, no destructive step.

### 1536 dimensions

`gemini-embedding-001` emits 3072. pgvector caps HNSW on the `vector` type at 2000. The options were `halfvec(3072)` or Matryoshka truncation to 1536.

1536 halves index memory, keeps the plain `vector` type and its tooling, and MRL
exists for this truncation.

**Moving to `halfvec(3072)` is a migration plus a backfill, not a re-ingest.**
Source documents and chunk text are untouched; only `chunk_embeddings` gains a
column and rows. A new dimension family gets its own column and partial index in
a migration, and the model registry maps model → (column, dimensions, operator
class). Nothing is re-fetched from Shopify and nothing is re-chunked.

> If that turns out not to hold — if a dimension change forces re-chunking or
> re-ingestion for any reason — **raise it before Phase 2 closes**, because it
> changes the cost of the D3 decision.

### Indexes are hand-written

`drizzle-kit push` regenerates HNSW DDL without the operator class, which
Postgres rejects (known open bug, May 2026). `push` is not used in any
environment. `generate` authors table DDL, which is then reviewed; vector
indexes, the generated `tsvector` column and all RLS live in hand-authored SQL.
`packages/db/test/schema-drift.test.ts` walks every Drizzle-declared table and
column and asserts the database has it, which is what makes hand-written
migrations safe.

### pgvector ≥ 0.8.0 is required

Migration 0001 fails the deployment otherwise. Iterative index scans, added in
0.8, fix HNSW returning fewer rows than `LIMIT` when a `WHERE` clause filters
hard — and our every query filters `tenant_id` and `embedding_model`. Without
it, retrieval quietly under-returns, which is the worst kind of bug in a system
whose ship bar is about what it fails to know.

## Consequences

- Retrieval joins `chunks` to `chunk_embeddings`. Indexed on both sides.
- `embedding_dims` carries a check constraint pinning it to 1536. A second
  dimension family relaxes that check in the same migration that adds it.
- Verified on Postgres 18.6 with pgvector 0.8.6.

---

## Measured: the score band is too narrow to threshold (Phase 2)

`retrieval_min_score` gates on cosine similarity because it is calibrated 0–1
and comparable across queries. Against the real corpus on
`gemini-embedding-001@1536`, the values cluster far more tightly than that
implies:

|                                     | cosine      |
| ----------------------------------- | ----------- |
| Answerable questions, correct chunk | 0.64 – 0.70 |
| Questions the corpus does not cover | 0.59 – 0.63 |

They overlap. A threshold at 0.65 would drop a correct size chart at 0.641; one
at 0.60 admits every irrelevant chunk. **No single cosine threshold separates
them on this embedding model**, and the shipped default of 0.35 admits
everything — which is why `knowledge_gaps` recorded nothing across three eval
runs: `search_knowledge` never returned "not found".

Two consequences.

**The threshold is not the instrument.** It is a floor against nonsense, not a
relevance decision, and it should be documented as such rather than tuned as if
one number could do the job.

**This is the evidence Q9 asked for.** The reranker choice was deferred to eval
data: fusion-only first, an LLM reranker behind a flag, decide on numbers. The
numbers are here, and fusion-only is not enough — reciprocal rank fusion orders
candidates but produces no calibrated relevance signal, so the "not found" case
has nothing to key on. A reranker that scores query-document relevance directly
is what makes the escalate-rather-than-guess path work, and it is the next
change in this area.

Until then the gap report will stay empty, and the agent will be handed
marginal chunks on questions the corpus cannot answer. The citation gate
contains the damage — a claim must cite a source that covers its concept — but
containment is not the same as knowing you do not know.

## Measured: the reranker is a three-way classifier, and the threshold is a label (Phase 2)

The section above deferred the relevance decision to a reranker, on the
evidence that cosine cannot make it. The reranker shipped, a full suite ran
with every verdict recorded, and the number it produces turns out not to be a
score.

Across 60 searches and 164 scored candidates on the third full run, **every
candidate scored exactly 0.00, 0.50 or 1.00. Nothing landed anywhere else.**

| top-1 score per search | searches | share |
| ---------------------- | -------- | ----- |
| 0.00                   | 18       | 30%   |
| 0.50                   | 6        | 10%   |
| 1.00                   | 36       | 60%   |

This is not a distribution that happens to be lumpy. It is the rubric, read
back. The reranker's prompt gives the model three anchors — 1.0 when the
document states the answer, around 0.5 when it is on the right topic but does
not answer, 0.0 when it is unrelated — and at temperature 0 the model returns
the anchors. There is no evidence it can produce a meaningful 0.7, and no
reason to expect one: nothing in the prompt describes what 0.7 would mean.

### What 0.5 means operationally

**The retrieved document is about the subject the customer asked about and
does not contain the answer.** Not "probably relevant", not "relevant with
lower confidence" — a different thing entirely from a low-confidence 1.0.

That distinction is what makes admitting the class a real decision rather than
a slider. A 0.5 chunk handed to the agent is on-topic material that cannot
support the answer, which is the precise raw material for a confident wrong
answer. The citation gate is the backstop — a claim must cite a source covering
every concept it asserts — but relying on it means routinely asking the model
to write from sources that do not answer the question and trusting a regex to
catch the ones where it obliged.

Excluding the class, which is what a 0.75 threshold does, converts those
searches into "nothing retrieved" and the turn escalates to a human.

### The threshold number is decorative

Because the scores take three values, every threshold in (0.5, 1.0] selects an
identical set of candidates, and so does every threshold in (0.0, 0.5]. Moving
`retrieval_min_score` from 0.75 to 0.9, or to 0.6, changes nothing at all.
There are exactly two reachable behaviours and the configured decimal selects
one of them.

So **`retrieval_min_score` is not calibrated and was never calibrated.** It is
a two-valued switch wearing four characters of apparent precision, and the
0.75 was chosen by intuition about what a confidence threshold should look
like. Stating that here rather than leaving the number to imply otherwise: a
reader who sees 0.75 in a config will reasonably assume someone measured
something, and nobody did.

### The rubric is the knob

The thing that would actually change a score is the prompt in
`llmReranker` — its anchors, and what it says counts as answering. Retuning
retrieval means editing that text and re-measuring, not nudging a number in
tenant config. Two of the six partial-scoring searches on this run
(`return receipt lost proof of purchase`, `exchange sale items 30% off`) are
questions the corpus does answer, so the rubric is currently too strict at the
0.5/1.0 boundary. That is a prompt change, and it is where the next
improvement in this area comes from.

A reranker that emits genuinely calibrated scores — a trained cross-encoder
rather than a rubric prompt — would make the threshold meaningful again. Until
one is in place, treating the number as a tuning surface is measuring the
wrong thing.

### Measured with

`packages/models/src/rerank-record.ts` records every verdict, wrapped outside
the cache so cached scores are captured too; `packages/evals/scripts/middle-class.ts`
reports the distribution and cross-checks itself against the run's outcomes.
Both are harness-only. Re-run after any rubric change:

```
BITC_RERANK_LOG=… pnpm evals run -- --suite en-core --out-json run.json
pnpm --filter @bitc/evals run middle -- --log … --outcomes run.json
```
