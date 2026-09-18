# Prompt caching — scoped, not built

Asked for before pricing: the size of the prize. **It is small, and the answer
is not to build it.**

## What is actually resent every turn

Measured from run 6: **4,613 input tokens per turn**, 87% of the model cost.

|                                                   | tokens     | share   |
| ------------------------------------------------- | ---------- | ------- |
| System prompt (`system.txt`)                      | ~917       | 20%     |
| Tool surface — six descriptions and their schemas | ~572       | 12%     |
| **Static, therefore cacheable**                   | **~1,489** | **32%** |
| History and retrieved chunks                      | ~3,124     | 68%     |

The cacheable part is the third that does not change. The other two thirds are
the conversation and the passages retrieved for _this_ question, and neither
repeats across turns in a way a cache can exploit.

## The prize

Gemini's implicit caching discounts repeated prefixes automatically; explicit
caching discounts more but charges storage. Taking a conservative 25% and an
optimistic 75% as the bracket:

| conversations/month | now    | at 25% | at 75% |
| ------------------- | ------ | ------ | ------ |
| 500                 | $2.38  | $2.21  | $1.88  |
| 2,000               | $9.53  | $8.86  | $7.52  |
| 10,000              | $47.66 | $44.31 | $37.61 |

**Between $0.50 and $10 a month.** Against a platform floor of $53.36/month
that is noise, and at the volume a first tenant will actually run it is under a
dollar.

## Therefore

**Do not build it, and do not price around it.** Prompt caching is the sort of
optimisation that feels like engineering and moves a number that was not the
problem. If it ever becomes worth doing, it will be because volume grew by two
orders of magnitude, and it can be done then — it is a provider option, not an
architecture.

## What would actually move the curve

Recorded here so the next person asking "can we cut the model bill" starts in
the right place.

**The 3,124 variable tokens, not the 1,489 static ones.** Two thirds of every
turn is retrieved chunks and history:

- **Retrieval currently admits the partial class** (ADR 0011), which by design
  sends the model more passages than a strict threshold would. That decision
  bought five recovered answers and it costs tokens; the trade was made
  deliberately and should be re-examined on cost only if cost ever matters.
- **Chunk size is not tuned for cost.** It was tuned for the citation gate,
  which is the right priority. Nobody has measured what a smaller `topK` does
  to answer quality, and that measurement costs a day of quota.
- **History grows unboundedly within a conversation.** `maxTokensPerConversation`
  caps it at 60,000, which is a safety limit rather than a cost one.

None of these is worth doing now. **At $47/month for 10,000 conversations the
model bill is not the problem, and the two-thirds is only worth attacking if
something changes that.** Latency is the better reason to touch retrieval — p95
is 8-9 seconds, and fewer or smaller passages would help that more visibly than
they would help the bill.
