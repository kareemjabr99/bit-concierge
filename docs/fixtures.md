# Writing fixtures

Nine of nine policy chunks and six of six shipping rules in the first fixture
set were drafted from assumption. Not six mistakes — one habit, applied
consistently. This is what changes.

## What went wrong

The fixtures were written before the corpus existed, to unblock Phase 1. That
was the right call. What was wrong was everything after: they were never
revisited when the real content arrived, they read as plausible policy, and one
of them — `tenant_config.policy_overrides.shipping` — was not a test fixture at
all but live configuration that `get_shipping_estimate` presented to customers
as the store's published rates.

The failure was not inventing numbers. It was **inventing numbers that looked
like facts, and then losing track of which was which.**

## Rules

**1. Invented content must be obviously invented.**

A fixture that could be mistaken for the real policy will be. Use values that
are unmistakably not the merchant's: a fictional store name, round numbers that
no real policy would use, an `example` domain. The current fixture corpus keeps
its wrong values on purpose — the return window says 14 days against a real 7 —
precisely so nobody can confuse the two, and its header says so in the first
sentence.

**2. Configuration is not a fixture.**

Anything under `tenant_config` reaches a customer. It is production data with a
development value in it, which is the most dangerous kind. It gets the same
scrutiny as code: sourced from the merchant, or absent.

**3. Every fixture that asserts a fact about the tenant carries its source.**

A comment naming the URL and the date it was read, or the word `INVENTED` in
capitals. No third option. A fixture with neither is a bug report waiting to be
written.

**4. When the real corpus lands, the fixtures get audited against it.**

Not "updated if convenient" — audited, as a task with an output. The Phase 2
audit found 15 of 15 wrong and took twenty minutes; doing it at the moment the
corpus was ingested would have cost the same and caught the shipping rates
before they reached a single eval run.

**5. Expectations are written from the corpus, not from what sounds right.**

Two of 103 golden-set cases had wrong expectations, both assuming the corpus
could not answer when it could. Both were written from intuition about what a
fashion store publishes. The rule now: query the index before writing the
expectation, and paste what you find into the case notes. Where a case says
"verified absent", someone ran the query.

## The tell

All of these failures share one shape: **something written to be provisional
was later read as authoritative, because nothing in it said which it was.**
That is the thing to watch for, more than any individual rule above.
