import type { LanguageModel, generateText } from 'ai';

type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]['providerOptions']>;
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { BitcError } from '@bitc/core';

export type ChatProvider = 'google' | 'anthropic';

export interface ChatModelSpec {
  /** Registry key, e.g. "google:gemini-3.5-flash-lite". Stored in tenant_config.chat_model. */
  key: string;
  provider: ChatProvider;
  modelId: string;
  contextTokens: number;
  maxOutputTokens: number;
  /** Provider-side reasoning effort, where the model supports it. */
  thinking?: 'minimal' | 'low' | 'medium' | 'high';
  /**
   * Provider quota, for harness-side pacing. The agent loop never reads this:
   * an eval runner or a CLI transcript paces itself from here, so swapping to
   * a paid key is a registry edit and nothing else.
   * See docs/adr/0006-model-abstraction.md.
   */
  quota?: { requestsPerMinute?: number; requestsPerDay?: number };
}

export interface ChatModelHandle {
  spec: ChatModelSpec;
  model: LanguageModel;
}

export interface ProviderCredentials {
  googleApiKey?: string;
  anthropicApiKey?: string;
}

/**
 * The only file that imports a chat provider SDK. Everything else sees a
 * registry key and an AI SDK LanguageModel. See docs/adr/0006-model-abstraction.md.
 */
export const CHAT_MODELS: Record<string, ChatModelSpec> = {
  'google:gemini-3.1-pro-preview': {
    key: 'google:gemini-3.1-pro-preview',
    provider: 'google',
    modelId: 'gemini-3.1-pro-preview',
    contextTokens: 1_000_000,
    maxOutputTokens: 16_384,
    thinking: 'medium',
  },
  // The development AND current ship-bar model. gemini-3.8-flash is absent on
  // purpose: twenty free-tier requests a day cannot run a 200-call eval suite,
  // and a registry entry is an invitation to burn a day's quota by accident.
  // Adding a paid model back is the swap procedure in docs/runbook.md.
  'google:gemini-3.5-flash-lite': {
    key: 'google:gemini-3.5-flash-lite',
    provider: 'google',
    modelId: 'gemini-3.5-flash-lite',
    contextTokens: 1_000_000,
    maxOutputTokens: 8_192,
    thinking: 'minimal',
    quota: { requestsPerMinute: 15 },
  },
  'google:gemini-3.6-flash': {
    key: 'google:gemini-3.6-flash',
    provider: 'google',
    modelId: 'gemini-3.6-flash',
    contextTokens: 1_000_000,
    maxOutputTokens: 8_192,
    thinking: 'low',
  },
  // Present to prove the abstraction. Unused in v1.
  'anthropic:claude-sonnet-5': {
    key: 'anthropic:claude-sonnet-5',
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    contextTokens: 200_000,
    maxOutputTokens: 16_384,
  },
};

export const resolveChatModel = (
  key: string,
  credentials: ProviderCredentials,
): ChatModelHandle => {
  const spec = CHAT_MODELS[key];
  if (!spec) {
    throw new BitcError('model_unknown', `Unknown chat model key "${key}"`, { context: { key } });
  }
  switch (spec.provider) {
    case 'google': {
      if (!credentials.googleApiKey)
        throw new BitcError('model_credentials', 'Google API key is not configured');
      const google = createGoogleGenerativeAI({ apiKey: credentials.googleApiKey });
      return { spec, model: google.languageModel(spec.modelId) };
    }
    case 'anthropic': {
      if (!credentials.anthropicApiKey)
        throw new BitcError('model_credentials', 'Anthropic API key is not configured');
      const anthropic = createAnthropic({ apiKey: credentials.anthropicApiKey });
      return { spec, model: anthropic.languageModel(spec.modelId) };
    }
  }
};

/**
 * Provider options for a turn, derived from the spec so call sites never
 * mention a provider by name.
 */
export const providerOptionsFor = (spec: ChatModelSpec): ProviderOptions => {
  if (spec.provider === 'google' && spec.thinking) {
    return { google: { thinkingConfig: { thinkingLevel: spec.thinking, includeThoughts: false } } };
  }
  return {};
};
