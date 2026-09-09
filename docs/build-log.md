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

**Wall clock: 0.93 h** (2026-09-10, 00:18 – 01:14)

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
- Two planned decisions were overturned by verification and cost rework:
  TypeScript 7 (blocked by typescript-eslint) and the initial `.js` import
  convention (incompatible with Node's native type stripping).
- Phase 0 was estimated at 2 days in the plan. It came in far under, because
  the plan's estimate assumed scaffolding from the Shopify template and wiring
  OAuth — that work moved to Phase 4 where it belongs, and Phase 0 reduced to
  foundation only.

**Estimate accuracy so far: Phase 0 estimated 2 d, actual ~1 h.** The estimate
was wrong about scope, not about pace. Treat later phase estimates with the same
suspicion until Phase 2 gives a second data point.
