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
const PACKAGE = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
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

  it.each(pnpmStepsIn(WORKFLOW))('CI step "pnpm %s" is covered by pnpm verify', (step) => {
    if (step in ENVIRONMENT_ONLY) return;
    expect(
      PACKAGE.scripts.verify,
      `CI runs "pnpm ${step}" and pnpm verify does not.\n` +
        `That is how two pushes went red on prettier --check while the documented ` +
        `local command passed.\nEither add it to the verify script, or add it to ` +
        `ENVIRONMENT_ONLY in this file with the reason it cannot run locally.`,
    ).toContain(step);
  });

  it('verify runs nothing CI skips', () => {
    // The other direction. A check only the developer runs is a check that
    // does not gate a merge, which makes it advisory dressed as enforcement.
    const verifySteps = PACKAGE.scripts
      .verify!.split('&&')
      .map((s) => s.trim().replace('pnpm ', ''));
    for (const step of verifySteps) {
      expect(steps, `pnpm verify runs "${step}" and CI does not`).toContain(step);
    }
  });

  it('verify:clean ends by running verify, so it inherits the list', () => {
    // The environmental half. verify:clean's value is the fresh clone, fresh
    // HOME and fresh database volume; the checks themselves must come from the
    // one list, not a second copy that can drift from it.
    const script = readFileSync('scripts/verify-clean.sh', 'utf8');
    expect(script).toMatch(/^pnpm verify$/m);
  });
});
