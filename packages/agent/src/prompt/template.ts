import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PromptVariables {
  brand_name: string;
  brand_description: string;
  brand_voice: string;
}

const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'system.txt');
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

let cached: string | undefined;
export const loadTemplate = (): string => (cached ??= readFileSync(TEMPLATE_PATH, 'utf8'));

/**
 * Renders the per-tenant system prompt. Every placeholder must resolve; an
 * unresolved one is a configuration error, not a prompt with a hole in it.
 */
export const renderSystemPrompt = (vars: PromptVariables, template = loadTemplate()): string => {
  const missing: string[] = [];
  const out = template.replace(PLACEHOLDER, (_, key: string) => {
    const value = vars[key as keyof PromptVariables];
    if (value === undefined || value === '') {
      missing.push(key);
      return '';
    }
    // Tenant-controlled text. Strip anything that could read as a new section.
    return value.replace(/[{}]/g, '').trim();
  });
  if (missing.length) throw new Error(`System prompt is missing variables: ${missing.join(', ')}`);
  return out;
};
