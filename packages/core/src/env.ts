import { z } from 'zod';
import { ConfigError } from './errors.ts';
import { LOG_LEVELS } from './logger.ts';

/**
 * Environment is validated in layers. Phase 0 and 1 need the base only; a
 * missing Meta secret must not stop the CLI harness from booting. Each layer is
 * checked where it is used, not all at once at startup.
 */

const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
});

const migrator = z.object({
  DATABASE_URL_MIGRATOR: z.string().min(1, 'DATABASE_URL_MIGRATOR is required to run migrations'),
});

const encryption = z.object({
  // 32 bytes, base64 — AES-256-GCM.
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'ENCRYPTION_KEY must be 32 bytes base64',
    ),
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
  ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
});

const models = z.object({
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1, 'GOOGLE_GENERATIVE_AI_API_KEY is required'),
  ANTHROPIC_API_KEY: z.string().optional(),
});

const web = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  WIDGET_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

const schemas = { base, migrator, encryption, models, web } as const;

export type EnvLayer = keyof typeof schemas;
export type BaseEnv = z.infer<typeof base>;
export type MigratorEnv = z.infer<typeof migrator>;
export type EncryptionEnv = z.infer<typeof encryption>;
export type ModelsEnv = z.infer<typeof models>;
export type WebEnv = z.infer<typeof web>;

interface EnvTypes {
  base: BaseEnv;
  migrator: MigratorEnv;
  encryption: EncryptionEnv;
  models: ModelsEnv;
  web: WebEnv;
}

/**
 * Reads and validates one layer. Throws ConfigError listing every missing key
 * at once — a boot failure should tell you everything that is wrong, not the
 * first thing that is wrong.
 */
export const readEnv = <L extends EnvLayer>(
  layer: L,
  source: NodeJS.ProcessEnv = process.env,
): EnvTypes[L] => {
  const result = schemas[layer].safeParse(source);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid environment for "${layer}" — ${detail}`, { layer });
  }
  return result.data as EnvTypes[L];
};
