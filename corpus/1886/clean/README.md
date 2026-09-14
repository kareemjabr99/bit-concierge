Plain-text policy documents for ingestion.

Drop files here as `<source-id>.txt`, one policy per file.

corpus/1886/clean/shipping-policy.txt
corpus/1886/clean/returns-and-exchanges.txt
corpus/1886/clean/privacy-policy.txt
corpus/1886/clean/terms-of-service.txt

Ingest with: pnpm --filter @bitc/rag ingest -- --clean corpus/1886/clean

These take precedence over the crawled version of the same policy: a page the
merchant exported is cleaner than one reconstructed from theme markup, and the
crawler's near-duplicate check will skip the crawled twin.

## The title is taken from the filename, not the first line

An earlier version of this file said the first line was the title. **Three of
1886's four exports broke that convention**, and it is worth being explicit
about why the rule is gone rather than tightened:

- `privacy-policy.txt` and `shipping-policy.txt` open with a full paragraph.
- `terms-of-service.txt` opens with `Introduction`, a section heading.
- `returns-and-exchanges.txt` opened with a blank line and then
  "You are eligible for returns or exchanges within 7 days:" — **the most-asked
  fact in the corpus.** A heuristic lifting first lines into titles would have
  deleted that sentence from the body on the strength of a guess about
  punctuation.

So the title comes from the filename, which is stable, accurate for all four,
and already what citations key on. Every line of the file stays in the body. A
first line that does look like a heading is reported in the ingest census, not
consumed.

**Assume the next merchant's files are worse than these.** Anything the loader
cannot account for is reported as a warning rather than indexed silently — that
is the contract, and it is the only part of this worth relying on.

## sources.json

Each export is a better rendering of a policy the store already publishes, not
a new policy. `sources.json` says which:

```json
{
  "sources": {
    "shipping-policy": {
      "sourceId": "policies/shipping-policy",
      "url": "https://1886riyadh.com/policies/shipping-policy",
      "supersedes": ["pages/shipping-policy"]
    }
  }
}
```

`sourceId` is the identity of the policy, so the export replaces the crawled
text in place and citations already pointing there keep working. `supersedes`
names the store's other rendering — Shopify publishes each policy at both
`/policies/x` and `/pages/x` — which is deleted on ingest.

Without an entry, an export is indexed as a new document and the index ends up
holding two answers to the same question. That happened on the first run here:
three shipping policies, two saying orders process in 1–10 business days and
one saying 2–3. An unmapped file still ingests, with a warning saying so.
