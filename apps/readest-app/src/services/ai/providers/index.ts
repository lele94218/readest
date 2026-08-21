import { OllamaProvider } from './OllamaProvider';
import { AIGatewayProvider } from './AIGatewayProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIProvider } from './OpenAIProvider';
import type { AIProvider, AISettings } from '../types';

export { OllamaProvider, AIGatewayProvider, OpenRouterProvider, AnthropicProvider, OpenAIProvider };

export function getAIProvider(settings: AISettings): AIProvider {
  switch (settings.provider) {
    case 'ollama':
      return new OllamaProvider(settings);
    case 'ai-gateway':
      if (!settings.aiGatewayApiKey) {
        throw new Error('API key required for AI Gateway');
      }
      return new AIGatewayProvider(settings);
    case 'openrouter':
      if (!settings.openrouterApiKey) {
        throw new Error('API key required for OpenRouter');
      }
      return new OpenRouterProvider(settings);
    case 'anthropic':
      if (!settings.anthropicApiKey) {
        throw new Error('API key required for Anthropic');
      }
      return new AnthropicProvider(settings);
    case 'openai':
      if (!settings.openaiApiKey) {
        throw new Error('API key required for OpenAI');
      }
      return new OpenAIProvider(settings);
    default:
      throw new Error(`Unknown provider: ${settings.provider}`);
  }
}
