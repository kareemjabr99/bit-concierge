import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * CI and `pnpm verify` must run the same checks.
 *
 * `verify:clean` was built to close the "green locally, red in CI" class after
 * two instances of it — a Postgres volume path and a cached lockfile verdict.
 * It closed the half of that class it was aimed at: **state on the developer's
 * machine that is not in the repository.** Fresh clone, fresh HOME, fresh
 * database volume, the README's own sequence.
 *
 * It did not close the other half, because nobody had seen the other half yet:
 * **CI running a command that `verify` does not.** CI ran `pnpm format`;
 * `verify` was `lint && typecheck && test`. Two pushes went red on
 * `prettier --check` — packages/models/src/cache.ts, then
 * corpus/1886/clean/README.md — while the documented local command passed,
 * because the documented local command never ran that check at all.
 *
 * A longer `verify` fixes those two. This fixes the class: the workflow is the
 * source of truth, and a step added to CI that `verify` cannot run is a failing
 * test on the machine of whoever adds it.
 */

const WORKFLOW = readFileSync('.github/workflows/ci.yml', 'utf8');
/**
 * The verification gate, as a script rather than a chain of npm scripts.
 *
 * It became a script because "chain it with &&" is a convention and a
 * convention can be held wrong — it was, one commit after being written down,
 * by piping verify through grep, where the pipeline's exit status is grep's.
 * So parity is now checked against what the script actually runs.
 */
const VERIFY = readFileSync('scripts/verify.sh', 'utf8');

/** What `pnpm <name>` resolves to inside the verify script. */
const RUNS: Record<string, RegExp> = {
  lint: /eslint/,
  typecheck: /tsc" --noEmit(?! -p)/,
  format: /prettier" --check/,
  test: /vitest" run/,
};

/** Every `pnpm <something>` a workflow step runs, in order of appearance. */
const pnpmStepsIn = (yaml: string): string[] =>
  [...yaml.matchAll(/^\s*(?:-\s*run:|run:)\s*pnpm\s+(.+)$/gm)]
    .map((m) => m[1]!.trim())
    .filter((cmd) => !cmd.startsWith('install'));

/**
 * Steps CI runs that `verify` deliberately does not, each with the reason.
 *
 * This list is the exemption, so it is short and every entry says why. A
 * command that needs infrastructure `verify` cannot assume belongs here;
 * anything else is drift.
 */
const ENVIRONMENT_ONLY: Record<string, string> = {
  'db:migrate': 'needs a live Postgres; verify:clean runs it against a throwaway container',
  'vitest run packages/evals': 'a subset of pnpm test, run again in its own job without a database',
};

describe('CI and pnpm verify run the same checks', () => {
  const steps = pnpmStepsIn(WORKFLOW);

  it('is reading a workflow that actually has steps', () => {
    // Without this, a renamed workflow file or a changed YAML shape would make
    // the suite pass by matching nothing — which is the failure mode of every
    // check that greps for trouble.
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps).toContain('lint');
    expect(steps).toContain('test');
  });

  it.each(pnpmStepsIn(WORKFLOW))('CI step "pnpm %s" is covered by verify.sh', (step) => {
    if (step in ENVIRONMENT_ONLY) return;
    const pattern = RUNS[step];
    expect(pattern, `no mapping for CI step "pnpm ${step}" — add one to RUNS`).toBeDefined();
    expect(
      pattern!.test(VERIFY),
      `CI runs "pnpm ${step}" and scripts/verify.sh does not.\n` +
        `That is how two pushes went red on prettier --check while the documented ` +
        `local command passed.\nEither add it to verify.sh, or add it to ` +
        `ENVIRONMENT_ONLY in this file with the reason it cannot run locally.`,
    ).toBe(true);
  });

  it('verify runs nothing CI skips', () => {
    // The other direction. A check only the developer runs is a check that
    // does not gate a merge, which makes it advisory dressed as enforcement.
    for (const [name, pattern] of Object.entries(RUNS)) {
      if (!pattern.test(VERIFY)) continue;
      expect(steps, `verify.sh runs "${name}" and CI does not`).toContain(name);
    }
  });

  it('verify.sh fails the whole run when a step fails', () => {
    // The property the script exists for. `set -e` plus an explicit check per
    // step means no step's failure can be swallowed — and, unlike a chain of
    // npm scripts, piping its OUTPUT cannot change its exit status.
    expect(VERIFY).toMatch(/set -euo pipefail/);
    expect(VERIFY).toContain('exit 1');
  });

  it('verify:clean ends by running verify, so it inherits the list', () => {
    // The environmental half. verify:clean's value is the fresh clone, fresh
    // HOME and fresh database volume; the checks themselves must come from the
    // one list, not a second copy that can drift from it.
    const script = readFileSync('scripts/verify-clean.sh', 'utf8');
    expect(script).toMatch(/^pnpm verify$/m);
  });
});
