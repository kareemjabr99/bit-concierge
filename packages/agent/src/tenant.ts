import { eq } from 'drizzle-orm';
import { asTenantId, type Language, type TenantId } from '@bitc/core';
import { schema, withTenant } from '@bitc/db';
import type { LookupLimits, ShippingRule, TenantRuntimeConfig } from './context.ts';

const DEFAULT_LOOKUP_LIMITS: LookupLimits = { perConversation: 5, perIpPerHour: 20 };

export const loadTenantConfig = async (tenantId: TenantId): Promise<TenantRuntimeConfig> => {
  const row = await withTenant(tenantId, async (tx) => {
    const [config] = await tx
      .select()
      .from(schema.tenantConfig)
      .where(eq(schema.tenantConfig.tenantId, tenantId));
    return config;
  });
  if (!row) throw new Error(`tenant_config missing for tenant ${tenantId}`);

  const overrides = (row.policyOverrides ?? {}) as {
    shipping?: ShippingRule[];
    lookupLimits?: Partial<LookupLimits>;
    messages?: TenantRuntimeConfig['messages'];
  };

  return {
    tenantId: asTenantId(row.tenantId),
    brandName: row.brandName,
    brandDescription: row.brandDescription ?? '',
    brandVoice: row.brandVoice,
    languages: row.languages as Language[],
    chatModel: row.chatModel,
    embeddingModel: row.embeddingModel,
    reranker: row.reranker,
    productionChatModel: row.productionChatModel,
    escalationEmails: row.escalationEmails,
    retrievalAdmits: row.retrievalAdmits as TenantRuntimeConfig['retrievalAdmits'],
    widgetOrigins: row.widgetOrigins,
    maxTokensPerConversation: row.maxTokensPerConversation,
    maxTurnsPerConversation: row.maxTurnsPerConversation,
    maxTokensPerDay: row.maxTokensPerDay,
    usageAlertPct: row.usageAlertPct,
    maxEscalationsPerHour: row.maxEscalationsPerHour,
    shipping: overrides.shipping ?? [],
    lookupLimits: { ...DEFAULT_LOOKUP_LIMITS, ...overrides.lookupLimits },
    messages: overrides.messages,
  };
};
