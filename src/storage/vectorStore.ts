import { Client } from '@libsql/client';
import { MemoryEntry, UpdateCandidate } from '../types/memory';
import { RetrieveFilters } from '../types/messages';
import { TursoClient } from './turso';

/**
 * Search result from vector store
 */
export interface SearchResult {
  id: string;
  score: number;
  payload: MemoryEntry;
}

/**
 * Vector store operations using Turso
 */
export class VectorStore {
  private client: Client;

  constructor(tursoClient: TursoClient) {
    this.client = tursoClient.getClient();
  }

  /**
   * Insert a memory entry with embedding
   */
  async insert(entry: MemoryEntry, embedding: number[]): Promise<void> {
    const updateQueueJson = JSON.stringify(entry.updateQueue);

    // Convert embedding to blob format
    const embeddingBlob = this.embeddingToBlob(embedding);

    await this.client.execute({
      sql: `
        INSERT OR REPLACE INTO memories (
          id, timeStamp, floatTimeStamp, weekday, category, subcategory,
          memoryClass, memory, originalMemory, compressedMemory, topicId,
          topicSummary, speakerId, speakerName, hitTime, updateQueue, embedding
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        entry.id,
        entry.timeStamp,
        entry.floatTimeStamp,
        entry.weekday,
        entry.category,
        entry.subcategory,
        entry.memoryClass,
        entry.memory,
        entry.originalMemory,
        entry.compressedMemory,
        entry.topicId,
        entry.topicSummary,
        entry.speakerId,
        entry.speakerName,
        entry.hitTime,
        updateQueueJson,
        embeddingBlob,
      ],
    });
  }

  /**
   * Search for similar memories using cosine similarity
   */
  async search(
    queryEmbedding: number[],
    limit = 10,
    filters?: RetrieveFilters
  ): Promise<SearchResult[]> {
    // For now, we fetch all and compute similarity in memory
    // TODO: Use sqlite-vec for native vector search when available
    const allEntries = await this.getAll(true);

    // Compute cosine similarity scores
    const scored: SearchResult[] = [];
    for (const entry of allEntries) {
      if (!entry.embedding) continue;

      // Apply filters if provided
      if (filters) {
        if (filters.floatTimeStamp?.gte && entry.floatTimeStamp < filters.floatTimeStamp.gte) continue;
        if (filters.floatTimeStamp?.lte && entry.floatTimeStamp > filters.floatTimeStamp.lte) continue;
        if (filters.speakerId && entry.speakerId !== filters.speakerId) continue;
        if (filters.category && entry.category !== filters.category) continue;
      }

      const score = this.cosineSimilarity(queryEmbedding, entry.embedding);
      scored.push({
        id: entry.id,
        score,
        payload: entry,
      });
    }

    // Sort by score descending and take top results
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Update a memory entry
   */
  async update(id: string, updates: Partial<MemoryEntry>, embedding?: number[]): Promise<void> {
    const setClauses: string[] = [];
    const args: (string | number | null | Uint8Array)[] = [];

    if (updates.memory !== undefined) {
      setClauses.push('memory = ?');
      args.push(updates.memory);
    }
    if (updates.category !== undefined) {
      setClauses.push('category = ?');
      args.push(updates.category);
    }
    if (updates.subcategory !== undefined) {
      setClauses.push('subcategory = ?');
      args.push(updates.subcategory);
    }
    if (updates.hitTime !== undefined) {
      setClauses.push('hitTime = ?');
      args.push(updates.hitTime);
    }
    if (updates.updateQueue !== undefined) {
      setClauses.push('updateQueue = ?');
      args.push(JSON.stringify(updates.updateQueue));
    }
    if (embedding) {
      setClauses.push('embedding = ?');
      args.push(this.embeddingToBlob(embedding));
    }

    if (setClauses.length === 0) return;

    args.push(id);

    await this.client.execute({
      sql: `UPDATE memories SET ${setClauses.join(', ')} WHERE id = ?`,
      args,
    });
  }

  /**
   * Delete a memory entry
   */
  async delete(id: string): Promise<void> {
    await this.client.execute({
      sql: 'DELETE FROM memories WHERE id = ?',
      args: [id],
    });
  }

  /**
   * Check if a memory entry exists
   */
  async exists(id: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: 'SELECT 1 FROM memories WHERE id = ? LIMIT 1',
      args: [id],
    });
    return result.rows.length > 0;
  }

  /**
   * Get a memory entry by ID
   */
  async get(id: string): Promise<(MemoryEntry & { embedding?: number[] }) | null> {
    const result = await this.client.execute({
      sql: 'SELECT * FROM memories WHERE id = ?',
      args: [id],
    });

    if (result.rows.length === 0) return null;

    return this.rowToMemoryEntry(result.rows[0], true);
  }

  /**
   * Get all memory entries
   */
  async getAll(includeEmbeddings = false): Promise<(MemoryEntry & { embedding?: number[] })[]> {
    const result = await this.client.execute('SELECT * FROM memories');
    return result.rows.map((row) => this.rowToMemoryEntry(row, includeEmbeddings));
  }

  /**
   * Get count of memory entries
   */
  async count(): Promise<number> {
    const result = await this.client.execute('SELECT COUNT(*) as count FROM memories');
    return Number(result.rows[0].count);
  }

  /**
   * Convert database row to MemoryEntry
   */
  private rowToMemoryEntry(
    row: Record<string, unknown>,
    includeEmbedding = false
  ): MemoryEntry & { embedding?: number[] } {
    const entry: MemoryEntry & { embedding?: number[] } = {
      id: row.id as string,
      timeStamp: row.timeStamp as string,
      floatTimeStamp: row.floatTimeStamp as number,
      weekday: (row.weekday as string) || '',
      category: (row.category as string) || '',
      subcategory: (row.subcategory as string) || '',
      memoryClass: (row.memoryClass as string) || '',
      memory: row.memory as string,
      originalMemory: (row.originalMemory as string) || '',
      compressedMemory: (row.compressedMemory as string) || '',
      topicId: row.topicId as number | null,
      topicSummary: (row.topicSummary as string) || '',
      speakerId: (row.speakerId as string) || '',
      speakerName: (row.speakerName as string) || '',
      hitTime: (row.hitTime as number) || 0,
      updateQueue: row.updateQueue ? JSON.parse(row.updateQueue as string) : [],
    };

    if (includeEmbedding && row.embedding) {
      entry.embedding = this.blobToEmbedding(row.embedding as Uint8Array);
    }

    return entry;
  }

  /**
   * Convert number array to Float32 blob
   */
  private embeddingToBlob(embedding: number[]): Uint8Array {
    const float32 = new Float32Array(embedding);
    return new Uint8Array(float32.buffer);
  }

  /**
   * Convert Float32 blob to number array
   */
  private blobToEmbedding(blob: Uint8Array): number[] {
    const float32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    return Array.from(float32);
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }
}
