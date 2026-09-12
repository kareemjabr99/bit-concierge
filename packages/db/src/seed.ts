import postgres from 'postgres';

/**
 * Seeds the single development tenant. Idempotent — keyed on the widget
 * public key. Runs as the migrator, which is the only role that can create a
 * tenant (the tenants policy only admits the tenant already in scope).
 *
 * Everything here is synthetic. The escalation address is a reserved domain.
 */
const url = process.env.DATABASE_URL_MIGRATOR;
if (!url) {
  console.error('DATABASE_URL_MIGRATOR is not set.');
  process.exit(1);
}

export const DEV_TENANT = {
  name: '1886 (development)',
  widgetPublicKey: 'pk_dev_1886',
  brandName: '1886',
  brandDescription: 'an elevated streetwear label from Riyadh',
  brandVoice:
    'Calm, direct, quietly confident. Speaks like a well-informed friend at the store, not a call centre',
  chatModel: 'google:gemini-3.5-flash-lite',
  // The model the ship bar is measured on. Currently the same as chatModel;
  // a paid swap changes both and voids every eval number on record.
  productionChatModel: 'google:gemini-3.5-flash-lite',
  embeddingModel: 'google:gemini-embedding-001@1536',
  reranker: 'llm:google:gemini-3.5-flash-lite',
  retrievalMinScore: 0.75,
  escalationEmails: ['escalations@bitc.example'],
  policyOverrides: {
    // Published shipping terms, taken verbatim from the storefront on
    // 2026-09-12 and checked against the ingested corpus.
    //
    // The earlier version of this block was invented — SMSA at 2-4 days, free
    // over 300 SAR, Aramex to five GCC countries at 45 SAR. None of it is the
    // store's. That mattered more than a wrong fixture normally does, because
    // get_shipping_estimate presents this to a customer as the store's
    // published rate, and the citation gate accepts a tool result as a
    // legitimate source. Invented numbers were reaching the customer with the
    // system's full confidence behind them.
    //
    // Cost is deliberately not a number: the policy says charges are
    // calculated at checkout and vary by destination. An agent that cannot
    // quote a figure is correct here.
    shipping: [
      {
        country: 'SA',
        label: 'Saudi Arabia',
        carrier: 'Express delivery',
        range: '1 to 7 business days after dispatch',
        cost: 'Calculated at checkout; varies by destination',
      },
      {
        country: 'INTL',
        label: 'International',
        carrier: 'DHL Express Worldwide',
        range: '5 to 10 business days after dispatch',
        cost: 'Calculated at checkout; varies by destination',
      },
    ],
  },
} as const;

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const [tenant] = await sql.unsafe<{ id: string }[]>(
    `INSERT INTO tenants (name, widget_public_key)
     VALUES ($1, $2)
     ON CONFLICT (widget_public_key) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [DEV_TENANT.name, DEV_TENANT.widgetPublicKey],
  );
  await sql.unsafe(
    `INSERT INTO tenant_config
       (tenant_id, brand_name, brand_description, brand_voice, chat_model, embedding_model,
        production_chat_model, reranker, retrieval_min_score, escalation_emails, policy_overrides)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (tenant_id) DO UPDATE SET
       brand_name = EXCLUDED.brand_name,
       brand_description = EXCLUDED.brand_description,
       brand_voice = EXCLUDED.brand_voice,
       chat_model = EXCLUDED.chat_model,
       embedding_model = EXCLUDED.embedding_model,
       production_chat_model = EXCLUDED.production_chat_model,
       reranker = EXCLUDED.reranker,
       retrieval_min_score = EXCLUDED.retrieval_min_score,
       escalation_emails = EXCLUDED.escalation_emails,
       policy_overrides = EXCLUDED.policy_overrides,
       updated_at = now()`,
    [
      tenant!.id,
      DEV_TENANT.brandName,
      DEV_TENANT.brandDescription,
      DEV_TENANT.brandVoice,
      DEV_TENANT.chatModel,
      DEV_TENANT.embeddingModel,
      DEV_TENANT.productionChatModel,
      DEV_TENANT.reranker,
      DEV_TENANT.retrievalMinScore,
      DEV_TENANT.escalationEmails as unknown as string[],
      JSON.stringify(DEV_TENANT.policyOverrides),
    ],
  );
  console.log(`seeded tenant ${tenant!.id} (${DEV_TENANT.widgetPublicKey})`);
} finally {
  await sql.end();
}
