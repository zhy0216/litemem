/**
 * OpenRouter LLM configuration
 */
export interface OpenRouterConfig {
  apiKey: string;
  baseUrl?: string;  // defaults to https://openrouter.ai/api/v1
  model: string;     // e.g., 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini'
  maxTokens?: number;
}

/**
 * Embedder configuration
 */
export interface EmbedderConfig {
  apiKey: string;
  baseUrl?: string;  // defaults to https://openrouter.ai/api/v1
  model: string;     // e.g., 'openai/text-embedding-3-small'
  dimensions?: number;
}

/**
 * Turso database configuration
 */
export interface TursoConfig {
  url: string;
  authToken?: string;
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  fileEnabled?: boolean;
  logDir?: string;
}

/**
 * Main LiteMem configuration
 */
export interface LiteMemConfig {
  messagesUse: 'user_only' | 'assistant_only' | 'hybrid';
  metadataGenerate: boolean;
  textSummary: boolean;
  llm: OpenRouterConfig;
  embedder: EmbedderConfig;
  retrieveStrategy: 'embedding' | 'context' | 'hybrid';
  update: 'online' | 'offline';
  turso: TursoConfig;
  logging?: LoggingConfig;
}

/**
 * Creates a default configuration with required overrides
 */
export function createDefaultConfig(
  overrides: Partial<LiteMemConfig> & Pick<LiteMemConfig, 'llm' | 'embedder' | 'turso'>
): LiteMemConfig {
  return {
    messagesUse: 'user_only',
    metadataGenerate: true,
    textSummary: true,
    retrieveStrategy: 'embedding',
    update: 'offline',
    ...overrides,
  };
}

/**
 * Default OpenRouter base URL
 */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
