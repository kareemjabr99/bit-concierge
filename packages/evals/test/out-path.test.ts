import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveOutPath } from '../src/safe-write.ts';

describe('--out paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'bitc-root-'));
  mkdirSync(join(root, 'history'));

  it('start at the repository root, not the process working directory', () => {
    expect(resolveOutPath(root, 'history/run.json')).toBe(join(root, 'history', 'run.json'));
  });

  it('refuse a directory that does not exist, before anything is spent', () => {
    expect(() => resolveOutPath(root, 'packages/evals/history/run.json')).toThrow(/does not exist/);
  });
});
