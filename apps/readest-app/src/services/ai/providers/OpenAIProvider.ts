import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';
import { getAIFetch } from '../utils/httpFetch';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Curated picker list. Prices are USD per million tokens (input / output),
 * checked against developers.openai.com/api/docs/pricing on 2026-08-21.
 */
export const OPENAI_MODELS = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', input: 4, output: 20 },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', input: 0.75, output: 4.5 },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', input: 0.2, output: 1.25 },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', input: 0.15, output: 0.6 },
] as const;

export const OPENAI_EMBEDDING_MODELS = [
  { id: 'text-embedding-3-small', label: 'text-embedding-3-small', input: 0.02 },
  { id: 'text-embedding-3-large', label: 'text-embedding-3-large', input: 0.13 },
] as const;

/**
 * Provider for OpenAI's own API, via the AI SDK's first-party `@ai-sdk/openai`
 * package.
 *
 * `OpenRouterProvider` can also reach OpenAI models by pointing its base URL
 * here, but it speaks the generic `/chat/completions` schema. This provider
 * uses the native client, so OpenAI-specific behaviour (the Responses API,
 * reasoning models, native embedding model ids) works as intended.
 *
 * Unlike {@link AnthropicProvider} this one *does* supply embeddings, so book
 * indexing (RAG) can run on it.
 *
 * Transport: outbound calls go through {@link getAIFetch} so the Tauri app
 * uses the Rust `@tauri-apps/plugin-http` transport (no CORS preflight, no
 * Android cleartext block); a pure web build falls back to `window.fetch`.
 */
export class OpenAIProvider implements AIProvider {
  id: AIProviderName = 'openai';
  name = 'OpenAI';
  requiresAuth = true;

  private settings: AISettings;
  private client: ReturnType<typeof createOpenAI>;
  private baseUrl: string;
  private apiKey: string;
  private httpFetch: typeof fetch;

  constructor(settings: AISettings) {
    this.settings = settings;
    if (!settings.openaiApiKey) {
      throw new Error('OpenAI API key required');
    }
    this.apiKey = settings.openaiApiKey;
    this.baseUrl = (settings.openaiBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.httpFetch = getAIFetch();
    this.client = createOpenAI({
      baseURL: this.baseUrl,
      apiKey: this.apiKey,
      ...(settings.openaiOrganization ? { organization: settings.openaiOrganization } : {}),
      fetch: this.httpFetch,
    });
    aiLogger.provider.init('openai', settings.openaiModel || DEFAULT_OPENAI_MODEL);
  }

  getModel(): LanguageModel {
    return this.client(this.settings.openaiModel || DEFAULT_OPENAI_MODEL);
  }

  getEmbeddingModel(): EmbeddingModel {
    return this.client.textEmbeddingModel(
      this.settings.openaiEmbeddingModel || DEFAULT_OPENAI_EMBEDDING_MODEL,
    );
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      aiLogger.provider.init('openai', 'healthCheck starting');
      // `/models` is auth-gated, free and fast — no token spend.
      const response = await this.httpFetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(this.settings.openaiOrganization
            ? { 'OpenAI-Organization': this.settings.openaiOrganization }
            : {}),
        },
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      aiLogger.provider.init('openai', 'healthCheck success');
      return true;
    } catch (e) {
      aiLogger.provider.error('openai', `healthCheck failed: ${(e as Error).message}`);
      return false;
    }
  }
}
