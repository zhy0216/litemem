import OpenAI from 'openai';
import { EmbedderConfig, OPENROUTER_BASE_URL } from '../types/config';
import { Embedder, EmbedderStats } from './base';

/**
 * OpenRouter/OpenAI-compatible embeddings
 */
export class OpenRouterEmbedder implements Embedder {
  private client: OpenAI;
  private config: EmbedderConfig;
  private stats: EmbedderStats;

  // Simple in-memory cache for embeddings
  private cache: Map<string, number[]> = new Map();
  private cacheEnabled: boolean;

  constructor(config: EmbedderConfig, enableCache = true) {
    this.config = config;
    this.cacheEnabled = enableCache;
    this.stats = {
      totalCalls: 0,
      totalTokens: 0,
    };

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || OPENROUTER_BASE_URL,
    });
  }

  /**
   * Get embedding dimensions
   */
  getDimensions(): number {
    return this.config.dimensions || 1536;  // Default for text-embedding-3-small
  }

  /**
   * Get embedding statistics
   */
  getStats(): EmbedderStats {
    return { ...this.stats };
  }

  /**
   * Embed a single text
   */
  async embed(text: string): Promise<number[]> {
    // Check cache first
    if (this.cacheEnabled) {
      const cached = this.cache.get(text);
      if (cached) {
        return cached;
      }
    }

    const response = await this.client.embeddings.create({
      model: this.config.model,
      input: text,
      dimensions: this.config.dimensions,
    });

    this.stats.totalCalls++;
    if (response.usage) {
      this.stats.totalTokens = (this.stats.totalTokens || 0) + response.usage.total_tokens;
    }

    const embedding = response.data[0].embedding;

    // Store in cache
    if (this.cacheEnabled) {
      this.cache.set(text, embedding);
    }

    return embedding;
  }

  /**
   * Embed multiple texts in batch
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Check which texts are cached
    const results: (number[] | null)[] = texts.map((text) =>
      this.cacheEnabled ? this.cache.get(text) || null : null
    );

    // Get indices of uncached texts
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (results[i] === null) {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    // Fetch uncached embeddings
    if (uncachedTexts.length > 0) {
      const response = await this.client.embeddings.create({
        model: this.config.model,
        input: uncachedTexts,
        dimensions: this.config.dimensions,
      });

      this.stats.totalCalls++;
      if (response.usage) {
        this.stats.totalTokens = (this.stats.totalTokens || 0) + response.usage.total_tokens;
      }

      // Map results back and update cache
      for (let i = 0; i < response.data.length; i++) {
        const embedding = response.data[i].embedding;
        const originalIndex = uncachedIndices[i];
        results[originalIndex] = embedding;

        if (this.cacheEnabled) {
          this.cache.set(uncachedTexts[i], embedding);
        }
      }
    }

    return results as number[][];
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
