import { createClient, Client } from '@libsql/client';
import { TursoConfig } from '../types/config';
import { MemoryEntry } from '../types/memory';

/**
 * Turso database client wrapper
 */
export class TursoClient {
  private client: Client;

  constructor(config: TursoConfig) {
    this.client = createClient({
      url: config.url,
      authToken: config.authToken,
    });
  }

  /**
   * Get the underlying libsql client
   */
  getClient(): Client {
    return this.client;
  }

  /**
   * Initialize the database schema
   */
  async initialize(): Promise<void> {
    // Create memories table
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        timeStamp TEXT NOT NULL,
        floatTimeStamp REAL NOT NULL,
        weekday TEXT,
        category TEXT,
        subcategory TEXT,
        memoryClass TEXT,
        memory TEXT NOT NULL,
        originalMemory TEXT,
        compressedMemory TEXT,
        topicId INTEGER,
        topicSummary TEXT,
        speakerId TEXT,
        speakerName TEXT,
        hitTime INTEGER DEFAULT 0,
        updateQueue TEXT,
        embedding F32_BLOB(1536),
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // TODO: Create vector index when sqlite-vec is properly supported
    // For now, we'll use brute-force similarity search
    // await this.client.execute(`
    //   CREATE INDEX IF NOT EXISTS memoriesEmbeddingIdx
    //   ON memories(libsql_vector_idx(embedding))
    // `);

    console.log('Database initialized');
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    this.client.close();
  }
}

/**
 * Create a Turso client instance
 */
export function createTursoClient(config: TursoConfig): TursoClient {
  return new TursoClient(config);
}
