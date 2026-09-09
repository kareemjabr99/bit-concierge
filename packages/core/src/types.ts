/** Opaque tenant identifier. Never construct one by casting a bare string. */
export type TenantId = string & { readonly __brand: 'TenantId' };

export const asTenantId = (value: string): TenantId => value as TenantId;

export const CHANNELS = ['web', 'instagram', 'whatsapp'] as const;
export type Channel = (typeof CHANNELS)[number];

export const LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Retention windows a tenant may choose. See docs/adr/0007-retention.md. */
export const RETENTION_DAYS = [30, 90, 365] as const;
export type RetentionDays = (typeof RETENTION_DAYS)[number];
