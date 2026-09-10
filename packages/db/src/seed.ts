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
  escalationEmails: ['escalations@bitc.example'],
  policyOverrides: {
    // Published shipping ranges. A tool result, so the agent may repeat them
    // as the store's published range — never as a promise. Synthetic.
    shipping: [
      {
        country: 'SA',
        label: 'Saudi Arabia',
        carrier: 'SMSA Express',
        range: '2–4 business days',
        cost: 'Free on orders over 300 SAR, otherwise 25 SAR',
      },
      {
        country: 'AE',
        label: 'United Arab Emirates',
        carrier: 'Aramex',
        range: '3–6 business days',
        cost: '45 SAR',
      },
      {
        country: 'KW',
        label: 'Kuwait',
        carrier: 'Aramex',
        range: '3–6 business days',
        cost: '45 SAR',
      },
      {
        country: 'BH',
        label: 'Bahrain',
        carrier: 'Aramex',
        range: '3–6 business days',
        cost: '45 SAR',
      },
      {
        country: 'QA',
        label: 'Qatar',
        carrier: 'Aramex',
        range: '3–6 business days',
        cost: '45 SAR',
      },
      {
        country: 'OM',
        label: 'Oman',
        carrier: 'Aramex',
        range: '4–7 business days',
        cost: '55 SAR',
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
        production_chat_model, escalation_emails, policy_overrides)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (tenant_id) DO UPDATE SET
       brand_name = EXCLUDED.brand_name,
       brand_description = EXCLUDED.brand_description,
       brand_voice = EXCLUDED.brand_voice,
       chat_model = EXCLUDED.chat_model,
       embedding_model = EXCLUDED.embedding_model,
       production_chat_model = EXCLUDED.production_chat_model,
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
      DEV_TENANT.escalationEmails as unknown as string[],
      JSON.stringify(DEV_TENANT.policyOverrides),
    ],
  );
  console.log(`seeded tenant ${tenant!.id} (${DEV_TENANT.widgetPublicKey})`);
} finally {
  await sql.end();
}
