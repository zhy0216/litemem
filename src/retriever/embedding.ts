import { VectorStore, SearchResult } from '../storage';
import { Embedder } from '../embeddings';
import { RetrieveFilters } from '../types/messages';

/**
 * Embedding-based retriever using vector similarity
 */
export class EmbeddingRetriever {
  private vectorStore: VectorStore;
  private embedder: Embedder;

  constructor(vectorStore: VectorStore, embedder: Embedder) {
    this.vectorStore = vectorStore;
    this.embedder = embedder;
  }

  /**
   * Retrieve memories by semantic similarity
   */
  async retrieve(
    query: string,
    limit = 10,
    filters?: RetrieveFilters
  ): Promise<SearchResult[]> {
    const queryEmbedding = await this.embedder.embed(query);
    return this.vectorStore.search(queryEmbedding, limit, filters);
  }
}
