import { writeFileSync } from 'node:fs';
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
