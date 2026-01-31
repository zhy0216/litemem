/**
 * Chat message role
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Raw input message from conversation
 */
export interface Message {
  role: MessageRole;
  content: string;
  timeStamp: string;  // Session timestamp (e.g., "2023/05/20 (Sat) 00:44")
  speakerId?: string;
  speakerName?: string;
}

/**
 * Normalized message with enriched metadata
 */
export interface NormalizedMessage extends Message {
  sessionTime: string;    // Original session timestamp
  weekday: string;        // Extracted weekday
  sequenceNumber?: number;
}

/**
 * Options for addMemory operation
 */
export interface AddMemoryOptions {
  forceExtract?: boolean;
}

/**
 * Result from addMemory operation
 */
export interface AddMemoryResult {
  addInputPrompt: string[];
  addOutputPrompt: string[];
  apiCallNums: number;
  memoryEntriesCreated: number;
}

/**
 * Extracted fact from LLM
 */
export interface ExtractedFact {
  sourceId: number;
  fact: string;
}

/**
 * Token usage statistics
 */
export interface TokenStats {
  summary: {
    totalLlmCalls: number;
    totalLlmTokens: number;
    totalEmbeddingCalls: number;
    totalEmbeddingTokens: number | null;
  };
  llm: {
    addMemory: {
      calls: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    update: {
      calls: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
  embedding: {
    totalCalls: number;
    totalTokens: number | null;
  };
}

/**
 * Filter options for retrieval
 */
export interface RetrieveFilters {
  floatTimeStamp?: {
    gte?: number;
    lte?: number;
  };
  speakerId?: string;
  category?: string;
  [key: string]: unknown;
}
