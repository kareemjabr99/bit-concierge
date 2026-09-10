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
