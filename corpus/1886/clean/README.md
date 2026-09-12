Plain-text policy documents for ingestion.

Drop files here as `<source-id>.txt`, one policy per file, first line the title:

  corpus/1886/clean/shipping-policy.txt
  corpus/1886/clean/returns-and-exchanges.txt
  corpus/1886/clean/privacy-policy.txt
  corpus/1886/clean/terms-of-service.txt

Ingest with:  pnpm --filter @bitc/rag ingest -- --clean corpus/1886/clean

These take precedence over the crawled version of the same policy: a page the
merchant exported is cleaner than one reconstructed from theme markup, and the
crawler's near-duplicate check will skip the crawled twin.
