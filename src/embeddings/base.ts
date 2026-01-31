/**
 * Base interface for text embedders
 */
export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
}

/**
 * Embedding statistics
 */
export interface EmbedderStats {
  totalCalls: number;
  totalTokens: number | null;
}
