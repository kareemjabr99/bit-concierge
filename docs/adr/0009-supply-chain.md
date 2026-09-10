# 0009 — Supply-chain policy, and why local and CI must verify the same way

**Status:** accepted, Phase 0 follow-up · **Date:** 2026-09-10

## Context

The first CI run failed with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`: six AI SDK
packages in the lockfile had been published 23 h 35 min before the run, inside
pnpm's 24-hour `minimumReleaseAge` floor (default since pnpm 11). The same
lockfile installed cleanly on the development machine, before and after.

Same pnpm (12.3.4), same lockfile, same policy. The difference was two pieces
of state on the developer machine that a fresh runner does not have:

1. **Non-strict resolution.** With `minimumReleaseAgeStrict: false` — the
   default — an exact pin to a version younger than the floor is installed
   anyway, and pnpm appends it to `minimumReleaseAgeExclude` in
   `pnpm-workspace.yaml` as an audit trail. That happened at the first install;
   the workspace file was then rewritten twice for an unrelated setting and the
   exclusions were lost without anyone noticing they had been added.
2. **A cached verdict outside the repository.**
   `~/Library/Caches/pnpm/lockfile-verified.jsonl` records that a lockfile
   passed, keyed by its hash. Every later local install hit that cache.
   Deleting the file reproduced CI's error locally, byte for byte.

CI was right. The committed lockfile carried entries the committed policy
rejects. Local was wrong because a verdict computed under a different policy
state was trusted from a cache the repository knows nothing about.

## Decision

Written into `pnpm-workspace.yaml`:

```yaml
minimumReleaseAge: 1440
minimumReleaseAgeStrict: true
```

- The floor is unchanged from pnpm's default. Writing it down means the policy
  no longer depends on which pnpm a machine runs; the default moved at v11 and
  can move again.
- **Strict mode is the fix.** Verified: a fresh resolution with a too-new exact
  pin now fails, writes no lockfile, and touches nothing. A lockfile that CI
  will reject can no longer be produced on a developer machine. This tightens
  the policy; nothing relaxes it.

`pnpm verify:clean` (`scripts/verify-clean.sh`) verifies from a clean clone
with a fresh store, a fresh verification cache and a fresh database volume,
following the README sequence. It targets the _class_ of failure — state on a
machine that is not in the repository — not the two instances of it seen in
Phase 0 (this one, and the Postgres 18 volume mount). It runs at every gate.

## The six pins

They were not chosen deliberately. `npm view <pkg> version` returns the
`latest` tag; I pinned what it returned without checking publish time. Strict
mode closes that gap — a same-day version cannot be pinned by accident again.

`ai@7.x` has shipped 92 releases in 77 days. At that cadence no patch has real
production mileage when it is pinned; what is exercised is the 7.0 line. The
protection is the age floor plus this repository's own tests on every bump,
not choosing an older patch.

Kept: `ai@7.0.97`. The changes between 7.0.95 and 7.0.97 (Cloudflare `atob`,
batch APIs, video webhooks) touch nothing we call. 7.0.94's _"enforce tool
choices in streamText"_ and 7.0.95's _"reject embedding responses with no
embeddings"_ are fixes we want.

**Fallback, if 7.0.97 misbehaves** — the 8 Sep 2026 release train, one publish
batch so no cross-package peer mismatch, and it carries the tool-choice fix:

| package                  | version |
| ------------------------ | ------- |
| `ai`                     | 7.0.94  |
| `@ai-sdk/google`         | 4.0.65  |
| `@ai-sdk/anthropic`      | 4.0.50  |
| `@ai-sdk/provider`       | 4.0.11  |
| `@ai-sdk/provider-utils` | 5.0.37  |
| `@ai-sdk/gateway`        | 4.0.76  |

## Open

Whether the floor should be 3 days (`4320`) rather than 24 hours. Three days
would have let the 7-hour hotfix chain that produced 7.0.95→97 settle and
covers slower-detected compromises; the cost is security fixes landing three
days late. Proposed, not decided — the floor is the owner's call.
