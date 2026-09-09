import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Nothing secret enters git history. This runs on every pull request because a
 * leaked key that reaches a remote has to be rotated, not reverted.
 */

const tracked = (): string[] =>
  execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);

/** Provider-specific prefixes. Precise enough not to fire on prose. */
const SECRET_PATTERNS: [name: string, pattern: RegExp][] = [
  ['Shopify access token', /shp(at|ca|pa|ss)_[a-fA-F0-9]{32}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Anthropic API key', /sk-ant-[0-9A-Za-z_-]{20,}/],
  ['OpenAI API key', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['Resend API key', /\bre_[A-Za-z0-9]{20,}\b/],
  ['Meta long-lived token', /\bEAA[A-Za-z0-9]{40,}\b/],
  ['private key block', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['postgres URL with password', /postgres(ql)?:\/\/[^\s:'"]+:(?!postgres@|localdev@)[^\s@'"]+@/],
];

const SKIP = /^(pnpm-lock\.yaml|.*\.(png|jpg|jpeg|gif|webp|woff2?|ico))$/;

describe('secret hygiene', () => {
  const files = tracked().filter((f) => !SKIP.test(f));

  it('tracks .env.example and nothing else that looks like an env file', () => {
    const envFiles = tracked().filter((f) => /(^|\/)\.env($|\.)/.test(f));
    expect(envFiles).toEqual(['.env.example']);
  });

  it('.env.example lists key names with no values', () => {
    const offenders = readFileSync('.env.example', 'utf8')
      .split('\n')
      .filter((line) => /^[A-Z0-9_]+=.+/.test(line.trim()));
    expect(offenders).toEqual([]);
  });

  it.each(SECRET_PATTERNS)('no %s in any tracked file', (_name, pattern) => {
    const hits: string[] = [];
    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      // This file necessarily contains the patterns it searches for.
      if (file === 'test/secrets.test.ts') continue;
      const match = pattern.exec(content);
      if (match) hits.push(`${file}: ${match[0].slice(0, 12)}…`);
    }
    expect(hits).toEqual([]);
  });

  it('no secret-shaped literal assigned to a secret-shaped name', () => {
    const assignment =
      /(?:api[_-]?key|secret|password|access[_-]?token|private[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{24,}['"]/i;
    const hits: string[] = [];
    for (const file of files) {
      if (file === 'test/secrets.test.ts') continue;
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (assignment.test(content)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});
