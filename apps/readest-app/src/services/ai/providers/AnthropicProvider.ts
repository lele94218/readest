import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';
import { getAIFetch } from '../utils/httpFetch';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

/**
 * Models offered in the settings picker. Anthropic's `/v1/models` endpoint
 * exists, but it also lists dated snapshots and retired aliases, so we ship a
 * curated list.
 *
 * Prices are USD per million tokens (input / output), checked against
 * platform.claude.com/docs/en/about-claude/pricing on 2026-08-21. They are
 * shown in the picker so the cost of a tap is visible before you make it —
 * Ask AI sends a passage and gets a paragraph back, so the output rate
 * dominates.
 */
export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', input: 5, output: 25 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', input: 2, output: 10 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', input: 1, output: 5 },
] as const;

/**
 * Provider for Anthropic's Messages API, via the AI SDK's first-party
 * `@ai-sdk/anthropic` package.
 *
 * Distinct from `OpenRouterProvider`, which can also reach Claude models but
 * only through an OpenAI-compatible translation layer — going direct keeps
 * Anthropic-native behaviour (adaptive thinking, prompt caching, the real
 * `stop_reason`) instead of whatever the shim maps them onto.
 *
 * Transport: outbound calls go through {@link getAIFetch} so the Tauri app
 * uses the Rust `@tauri-apps/plugin-http` transport (no CORS preflight, no
 * Android cleartext block). A pure web build falls back to `window.fetch`,
 * which is why `anthropic-dangerous-direct-browser-access` is set — without
 * it the API rejects browser-originated requests outright.
 */
export class AnthropicProvider implements AIProvider {
  id: AIProviderName = 'anthropic';
  name = 'Anthropic (Claude)';
  requiresAuth = true;

  private settings: AISettings;
  private client: ReturnType<typeof createAnthropic>;
  private baseUrl: string;
  private apiKey: string;
  private httpFetch: typeof fetch;

  constructor(settings: AISettings) {
    this.settings = settings;
    if (!settings.anthropicApiKey) {
      throw new Error('Anthropic API key required');
    }
    this.apiKey = settings.anthropicApiKey;
    this.baseUrl = (settings.anthropicBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.httpFetch = getAIFetch();
    this.client = createAnthropic({
      baseURL: this.baseUrl,
      apiKey: this.apiKey,
      headers: {
        // Required for any request whose Origin is a browser context; harmless
        // when the Tauri HTTP transport handles the call instead.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      fetch: this.httpFetch,
    });
    aiLogger.provider.init('anthropic', settings.anthropicModel || DEFAULT_ANTHROPIC_MODEL);
  }

  getModel(): LanguageModel {
    return this.client(this.settings.anthropicModel || DEFAULT_ANTHROPIC_MODEL);
  }

  /**
   * Anthropic ships no embedding endpoint, so book indexing (RAG) cannot run
   * on this provider. Chat — including Ask AI on a selection, which sends the
   * surrounding text directly — does not touch embeddings.
   */
  getEmbeddingModel(): EmbeddingModel {
    throw new Error(
      'Anthropic does not provide an embedding API. ' +
        'Use Ollama or an OpenAI-compatible provider for book indexing.',
    );
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      aiLogger.provider.init('anthropic', 'healthCheck starting');
      // `/v1/models` is auth-gated but free and fast — no token spend.
      const response = await this.httpFetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      aiLogger.provider.init('anthropic', 'healthCheck success');
      return true;
    } catch (e) {
      aiLogger.provider.error('anthropic', `healthCheck failed: ${(e as Error).message}`);
      return false;
    }
  }
}
