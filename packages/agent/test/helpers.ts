import postgres from 'postgres';
import { MockLanguageModelV4 } from 'ai/test';
import { up } from '@bitc/db/migrate';
import { asTenantId, createLogger, type TenantId } from '@bitc/core';
import { CHAT_MODELS, type ChatModelHandle } from '@bitc/models';
import { MockShopifyClient } from '@bitc/shopify';
import { FixtureKnowledge, type TurnDeps } from '../src/index.ts';

// Must be set before @bitc/db opens its lazy connection.
process.env.DATABASE_URL ??= 'postgres://bitc_app_local:localdev@localhost:55432/bitconcierge';
export const ADMIN_URL =
  process.env.DATABASE_URL_MIGRATOR ?? 'postgres://postgres:postgres@localhost:55432/bitconcierge';

export const admin = () => postgres(ADMIN_URL, { max: 1, onnotice: () => {} });

export const prepareDatabase = async (): Promise<void> => {
  const sql = admin();
  try {
    await up(sql);
    await sql.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bitc_app_local') THEN
          CREATE USER bitc_app_local WITH PASSWORD 'localdev';
        END IF;
      END $$;
      GRANT bitc_app TO bitc_app_local;
      GRANT CONNECT ON DATABASE bitconcierge TO bitc_app_local;
    `);
  } finally {
    await sql.end();
  }
};

export interface TestTenantOptions {
  maxTurnsPerConversation?: number;
  maxTokensPerConversation?: number;
  maxTokensPerDay?: number;
  maxEscalationsPerHour?: number;
  lookupLimits?: { perConversation?: number; perIpPerHour?: number };
}

/** Seeds a throwaway tenant as the admin role. Returns its id. */
export const seedTestTenant = async (
  label: string,
  options: TestTenantOptions = {},
): Promise<TenantId> => {
  const sql = admin();
  try {
    const [t] = await sql.unsafe<{ id: string }[]>(
      `INSERT INTO tenants (name, widget_public_key) VALUES ($1, $2) RETURNING id`,
      [label, `pk_test_${label}_${Date.now()}`],
    );
    await sql.unsafe(
      `INSERT INTO tenant_config
         (tenant_id, brand_name, brand_description, brand_voice, chat_model, embedding_model,
          escalation_emails, policy_overrides, max_turns_per_conversation, max_tokens_per_conversation,
          max_tokens_per_day, max_escalations_per_hour)
       VALUES ($1, '1886', 'a test label', 'calm', 'google:gemini-3.8-flash', 'google:gemini-embedding-001@1536',
               '{ops@bitc.example}', $2::jsonb, $3, $4, $5, $6)`,
      [
        t!.id,
        JSON.stringify({
          shipping: [
            {
              country: 'SA',
              label: 'Saudi Arabia',
              carrier: 'SMSA',
              range: '2–4 business days',
              cost: 'Free over 300 SAR',
            },
          ],
          lookupLimits: options.lookupLimits ?? {},
        }),
        options.maxTurnsPerConversation ?? 25,
        options.maxTokensPerConversation ?? 60000,
        options.maxTokensPerDay ?? 5_000_000,
        options.maxEscalationsPerHour ?? 20,
      ],
    );
    return asTenantId(t!.id);
  } finally {
    await sql.end();
  }
};

export const dropTenant = async (tenantId: TenantId): Promise<void> => {
  const sql = admin();
  try {
    await sql.unsafe(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  } finally {
    await sql.end();
  }
};

export interface ScriptStep {
  text?: string;
  tools?: { name: string; input: Record<string, unknown> }[];
}

/**
 * A model that follows a script: each call returns the next step's text and
 * tool calls. Lets the loop, the gates and persistence be tested without a
 * network or a key, and with total control over what the "model" says.
 */
export const scripted = (steps: ScriptStep[]): MockLanguageModelV4 => {
  let i = 0;
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'scripted',
    doGenerate: async () => {
      const step = steps[i] ?? { text: '(script exhausted)' };
      i += 1;
      const content: Array<Record<string, unknown>> = [];
      if (step.text) content.push({ type: 'text', text: step.text });
      (step.tools ?? []).forEach((t, k) =>
        content.push({
          type: 'tool-call',
          toolCallId: `call-${i}-${k}`,
          toolName: t.name,
          input: JSON.stringify(t.input),
        }),
      );
      return {
        content,
        finishReason: { unified: step.tools?.length ? 'tool-calls' : 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 20, text: 20, reasoning: 0 },
        },
        warnings: [],
      } as unknown as Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;
    },
  });
};

export const depsWith = (model: MockLanguageModelV4): TurnDeps => ({
  chat: { spec: CHAT_MODELS['google:gemini-3.8-flash']!, model } as ChatModelHandle,
  shopify: new MockShopifyClient(),
  knowledge: new FixtureKnowledge(),
  logger: createLogger({ level: 'error', write: () => {} }),
});

export const uniqueId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
