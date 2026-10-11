import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stripStatusUrls } from '@bitc/core';

/**
 * The only way eval output reaches a file.
 *
 * A reply can carry an order's status URL, and that URL is the credential for
 * the order (docs/adr/0012). Run output is committed to `packages/evals/history/`
 * on purpose — the evidence behind every number — so a URL in a reply would be
 * committed with it. Stripped here, at the write, so no caller has to remember;
 * test/status-link-history.test.ts fails if a writer goes around this.
 */
export const writeEvalFile = (path: string, text: string): void => {
  writeFileSync(path, stripStatusUrls(text));
};

/**
 * Where `--out` and `--out-json` point, resolved from the repository root.
 *
 * `pnpm --filter` runs the runner with `packages/evals` as its working
 * directory, so a path resolved from there put the first re-baseline in
 * `packages/evals/packages/evals/history/` — after an hour of model requests,
 * and only because someone had created the directory to stop the write from
 * throwing. Every documented command names the path from the repository root,
 * so that is what a relative path means. The directory must already exist, and
 * is checked before the run starts rather than after it has spent the quota.
 */
export const resolveOutPath = (root: string, path: string): string => {
  const full = resolve(root, path);
  if (!existsSync(dirname(full))) {
    throw new Error(
      `--out directory does not exist: ${dirname(full)} (relative paths start at ${root})`,
    );
  }
  return full;
};
