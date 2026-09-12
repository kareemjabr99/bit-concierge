# Build log

Actual hours per phase, recorded at each checkpoint. Not estimates, not
reconstructed later. This exists to support a pricing conversation about R&D
investment, so it records what the time actually went on — including the parts
that were not productive.

Hours are wall-clock on the phase. Where an incident consumed time, it is broken
out rather than absorbed, because "how long does a phase like this take" and
"how long did this one take" are different questions and both get asked.

---

## Phase 0 — Foundation

**Wall clock: 1.10 h** (2026-09-10, 00:18 – 01:24)

| Activity                                                         | Hours    |
| ---------------------------------------------------------------- | -------- |
| Version verification and toolchain selection                     | 0.10     |
| Repository skeleton, workspace, root configuration               | 0.10     |
| `packages/core` — env, logger, redaction, identifiers            | 0.10     |
| `packages/db` — schema (15 tables), 4 migrations, runner, client | 0.25     |
| Test suite — 80 tests incl. RLS proof and its mutation testing   | 0.15     |
| CI, Docker, Fly configuration                                    | 0.05     |
| README and eight ADRs                                            | 0.13     |
| **Incident — host disk full, Docker containerd corruption**      | **0.05** |

### Notes

- The disk incident was environmental, not project work: the build machine had
  188 MB free, which broke the Docker daemon's containerd metadata store and
  blocked both dependency install and the database. Resolved by clearing
  regenerable caches. It is logged because it was real elapsed time.
- Three planned decisions were overturned by verification and cost rework:
  TypeScript 7 (blocked by typescript-eslint), the initial `.js` import
  convention (incompatible with Node's native type stripping), and the
  Compose volume mount path (Postgres 18 moved it).
- Running the README's own setup sequence, rather than the ad-hoc container
  used during development, is what caught the Compose bug. Worth keeping as a
  habit at every checkpoint: verify the documented path, not the one you
  happen to have running.
- Phase 0 was estimated at 2 days in the plan. It came in far under, because
  the plan's estimate assumed scaffolding from the Shopify template and wiring
  OAuth — that work moved to Phase 4 where it belongs, and Phase 0 reduced to
  foundation only.

### Follow-up — CI failure investigation (same day)

**Wall clock: 0.25 h** (20:13 – 20:28 UTC)

First CI run red on `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. Root-caused to
non-strict resolution plus a verification cache outside the repo (ADR 0009);
fixed with strict mode, an explicit floor, and `pnpm verify:clean`. Logged
separately from Phase 1 so Phase 1's hours stay honest.

**Estimate accuracy so far: Phase 0 estimated 2 d, actual ~1 h.** The estimate
was wrong about scope, not about pace. Treat later phase estimates with the same
suspicion until Phase 2 gives a second data point.

---

## Phase 1 — Core agent, mocked

**Wall clock: 1.0 h** (2026-09-10, 20:22 – 21:21 UTC, through clean verification)

| Activity                                                               | Hours    |
| ---------------------------------------------------------------------- | -------- |
| Model registry, mock store and fixtures, prompt template, both gates   | 0.18     |
| Loop, six tools, identity gate, escalation, persistence, CLI           | 0.22     |
| Scripted-model test suite and identity-gate suite (146 → 148 tests)    | 0.13     |
| Real-model runs and the gate precision fixes they drove                | 0.22     |
| Clean-clone verification, docs, plan revision                          | 0.07     |
| **Incident — Docker daemon down again**                                | **0.02** |
| **Incident — pnpm lockfile written without peer resolution**           | **0.05** |
| **Incident — Gemini free-tier daily quota exhausted mid-verification** | **0.08** |

### Notes

- Four real-model false suppressions taught the citation gate more than the
  scripted tests had: quoted tool values, paraphrased product names, source
  links and vague timing words are all rules that exist because a transcript
  showed the need. Each has the transcript sentence as its test.
- The free tier on `gemini-3.8-flash` is twenty requests a day. That is a
  Phase 2 planning fact, not an inconvenience: an eval run is 200–300 calls.
- Two commits were rebuilt before pushing — one landed partial under a full
  message when an edit script failed mid-way, one landed lint-red because the
  gate only checked tests. Both gates now check everything and stop.
- Phase 1 was estimated at 4 days. Actual 1.0 h. The estimate assumed the
  scaffolding and integration time of a human-paced week; the pace is not the
  point, the scope was right this time. Phase 2 is the first estimate made
  with two data points behind it.

**Estimate accuracy: Phase 0 2 d → 1.1 h; Phase 1 4 d → 1.0 h.**

---

## Phase 2 — RAG and evals (partial)

**Wall clock: 1.1 h** (2026-09-10, 22:31 – 23:37 UTC)

| Activity                                                  | Hours |
| --------------------------------------------------------- | ----- |
| Supply-chain floor to three days, repin, registry change  | 0.12  |
| Citation-gate adversarial suite and the rebuild it forced | 0.25  |
| Corpus: crawl, HTML and table extraction, de-duplication  | 0.18  |
| Chunking, ingestion, hybrid retrieval, knowledge gaps     | 0.22  |
| Eval harness: runner, metrics, baselines, diff, report    | 0.20  |
| Golden set (33 cases), runbook, CI, docs                  | 0.13  |

### Notes

- The adversarial suite paid for itself immediately: fabricated policies got
  past four of the gate's five exemptions. The rebuild replaced all five with
  one rule and cost nothing measurable in false suppressions.
- The first eval run reported eight fabricated literals. **All eight were the
  gate withholding correct answers** — an anchored source URL, the word
  "available", and the store's own name, which is a four-digit number. That is
  the single most valuable thing the harness has done so far, and it argues for
  running it before trusting any gate metric.
- Real content changed a fact the fixtures had wrong: the return window is
  **7 days**, not 14.
- Free-tier quota is the binding constraint on this phase: 100 embedding
  requests a day and 15 chat requests a minute. The embedding cache and the
  runner's pacing exist because of it, both harness-side.

**Estimate accuracy: Phase 0 2 d → 1.1 h; Phase 1 4 d → 1.0 h; Phase 2 5 d →
1.1 h so far, and not finished.** Phase 2 is the first phase where the estimate
is not simply too high: the remaining work is real and is listed at the gate.

---

## Phase 2 — completion pass

**Wall clock: 3.2 h** (2026-09-12, 12:31 – 15:45 UTC)

| Activity                                                          | Hours |
| ----------------------------------------------------------------- | ----- |
| LLM reranker, separation measurement, threshold migration         | 0.35  |
| Golden set to 103 cases from the verified corpus                  | 0.45  |
| Two full 103-case runs (≈50 min each, mostly waiting)             | 1.10  |
| Adjudicating failures; two more gate false-positive classes fixed | 0.55  |
| Fixture audit, corpus findings, reindex command, quota work       | 0.45  |
| ADRs, runbook, docs                                               | 0.30  |

### Notes

- **Every reported "fabricated literal" across three runs — twelve of twelve —
  was the gate withholding a correct answer.** None was a model fabrication.
  That is the most useful thing the harness has produced, and it is an argument
  about how the metric is read rather than about the gate being too strict:
  suppression is the safe direction, and each one escalated to a human.
- **Two of 103 drafted cases had wrong expectations**, both in the same
  direction — assuming the corpus could not answer when it could. A systematic
  bias, not bad luck, and the evidence for why Phase 5 client validation is not
  optional.
- The second full run hit a **500/day chat cap at case 62** and wrote a
  baseline from it before I caught it. The runner now reports an incomplete run
  and refuses to record a baseline from one. That failure mode was predictable
  from the first wrong-baseline incident and I did not guard it in time.
- Estimates: Phase 0 2 d → 1.1 h; Phase 1 4 d → 1.0 h; Phase 2 5 d → 4.3 h
  across two sittings, and still not closed.
