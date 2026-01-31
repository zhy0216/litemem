import OpenAI from 'openai';
import { OpenRouterConfig, OPENROUTER_BASE_URL } from '../types/config';

/**
 * Usage information from API calls
 */
export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Base interface for LLM managers
 */
export interface LLMManager {
  generateResponse(
    messages: Array<{ role: string; content: string }>,
    responseFormat?: { type: string }
  ): Promise<{ response: string; usage: UsageInfo }>;
}

/**
 * Extracts and cleans JSON from LLM response
 */
export function cleanResponse(response: string): Array<{ sourceId: number; fact: string }> {
  // Remove code block markers if present
  const codeBlockPattern = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = response.trim().match(codeBlockPattern);
  const cleaned = match ? match[1].trim() : response.trim();

  try {
    const parsed = JSON.parse(cleaned);

    // Handle { "data": [...] } format
    if (parsed && typeof parsed === 'object' && 'data' in parsed && Array.isArray(parsed.data)) {
      return parsed.data.map((item: { source_id: number; fact: string }) => ({
        sourceId: Number(item.source_id),
        fact: item.fact,
      }));
    }

    // Handle direct array format
    if (Array.isArray(parsed)) {
      return parsed.map((item: { source_id: number; fact: string }) => ({
        sourceId: Number(item.source_id),
        fact: item.fact,
      }));
    }

    return [];
  } catch (e) {
    console.error('JSON parsing error:', e);
    return [];
  }
}

/**
 * Creates OpenAI client configured for OpenRouter
 */
export function createOpenRouterClient(config: OpenRouterConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || OPENROUTER_BASE_URL,
  });
}
