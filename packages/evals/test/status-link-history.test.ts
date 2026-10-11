import { globSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_URL } from '@bitc/core';
import { writeEvalFile } from '../src/safe-write.ts';

/**
 * An order's status URL is the credential for the order (docs/adr/0012), and
 * `packages/evals/history/` is committed. Three things keep one out of it: the
 * writer strips, nothing writes around the writer, and what is already
 * committed is clean.
 */

const link =
  'https://shop.myshopify.com/80752312542/orders/0123456789abcdef0123456789abcdef/authenticate?key=fedcba9876543210fedcba9876543210';

describe('eval output carries no status link', () => {
  it('strips the link from text and JSON on its way to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bitc-evals-'));
    const md = join(dir, 'run.md');
    const json = join(dir, 'run.json');
    writeEvalFile(md, `reply: Your order is here ${link}.`);
    writeEvalFile(json, JSON.stringify({ reply: `see ${link}`, raw: `see ${link} [[c:t:order]]` }));
    for (const path of [md, json]) {
      const text = readFileSync(path, 'utf8');
      expect(text).not.toContain('authenticate');
      expect(text).not.toContain('0123456789abcdef');
      expect(text).toContain('[status-link]');
    }
    expect(JSON.parse(readFileSync(json, 'utf8')).reply).toBe('see [status-link]');
  });

  it('has no writer that goes around it', () => {
    const files = [
      ...globSync('packages/evals/src/**/*.ts'),
      ...globSync('packages/evals/scripts/**/*.ts'),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const path of files.filter((p) => !p.endsWith('safe-write.ts'))) {
      const text = readFileSync(path, 'utf8');
      expect(
        /\bwriteFileSync\b|\bwriteFile\b|createWriteStream/.test(text),
        `${path} writes a file directly. Use writeEvalFile, which strips order status links.`,
      ).toBe(false);
    }
  });

  it('has none in what is already committed', () => {
    const files = globSync('packages/evals/history/**/*').filter((p) =>
      /\.(md|json|txt|log)$/.test(p),
    );
    expect(files.length).toBeGreaterThan(5);
    for (const path of files) {
      expect(readFileSync(path, 'utf8').match(STATUS_URL), path).toBeNull();
    }
  });
});
