import {
  LiteMemConfig,
  MemoryEntry,
  createMemoryEntry,
  Message,
  NormalizedMessage,
  AddMemoryOptions,
  AddMemoryResult,
  TokenStats,
  RetrieveFilters,
} from './types';
import { TursoClient, createTursoClient, VectorStore } from './storage';
import { OpenRouterManager, ExtractionResult } from './llm';
import { OpenRouterEmbedder } from './embeddings';
import { MessageNormalizer, assignSequenceNumbers, createLogger, Logger } from './utils';

/**
 * LiteMemory - Long-term memory management for AI agents
 */
export class LiteMemory {
  private config: LiteMemConfig;
  private logger: Logger;
  private tursoClient: TursoClient;
  private vectorStore: VectorStore;
  private llmManager: OpenRouterManager;
  private embedder: OpenRouterEmbedder;
  private normalizer: MessageNormalizer;

  // Token statistics
  private tokenStats = {
    addMemory: {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
    update: {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  };

  // Buffer for messages before extraction
  // TODO: Implement proper short-term buffer with topic segmentation
  private messageBuffer: NormalizedMessage[] = [];
  private bufferTokenLimit = 2000;

  constructor(config: LiteMemConfig) {
    this.config = config;
    this.logger = createLogger('LiteMemory', config.logging?.level || 'info');

    this.logger.info('Initializing LiteMemory');

    // Initialize components
    this.tursoClient = createTursoClient(config.turso);
    this.vectorStore = new VectorStore(this.tursoClient);
    this.llmManager = new OpenRouterManager(config.llm);
    this.embedder = new OpenRouterEmbedder(config.embedder);
    this.normalizer = new MessageNormalizer();

    this.logger.info('LiteMemory initialized successfully');
  }

  /**
   * Create LiteMemory instance from config object
   */
  static fromConfig(config: LiteMemConfig): LiteMemory {
    return new LiteMemory(config);
  }

  /**
   * Initialize the database (must be called before use)
   */
  async initialize(): Promise<void> {
    await this.tursoClient.initialize();
  }

  /**
   * Add new memory entries from messages
   */
  async addMemory(
    messages: Message | Message[],
    options: AddMemoryOptions = {}
  ): Promise<AddMemoryResult> {
    const callId = `addMemory_${Date.now()}`;
    this.logger.info(`[${callId}] Starting addMemory`);

    const result: AddMemoryResult = {
      addInputPrompt: [],
      addOutputPrompt: [],
      apiCallNums: 0,
      memoryEntriesCreated: 0,
    };

    // Normalize messages
    const normalizedMessages = this.normalizer.normalizeMessages(messages);
    const messagesWithSeq = assignSequenceNumbers(normalizedMessages);

    this.logger.debug(`[${callId}] Normalized ${messagesWithSeq.length} messages`);

    // Add to buffer
    this.messageBuffer.push(...messagesWithSeq);

    // Check if we should extract (based on forceExtract or buffer threshold)
    // TODO: Implement proper topic segmentation and buffer management
    const shouldExtract = options.forceExtract || this.messageBuffer.length >= 10;

    if (!shouldExtract) {
      this.logger.debug(`[${callId}] Buffer not full, waiting for more messages`);
      return result;
    }

    // Filter messages based on config
    const messagesToProcess = this.filterMessagesByRole(this.messageBuffer);

    if (messagesToProcess.length === 0) {
      this.logger.debug(`[${callId}] No messages to process after filtering`);
      this.messageBuffer = [];
      return result;
    }

    // Extract facts using LLM
    if (this.config.metadataGenerate) {
      this.logger.info(`[${callId}] Extracting metadata from ${messagesToProcess.length} messages`);

      // Group messages into segments (simplified - no topic segmentation for now)
      const segments = [messagesToProcess];

      const extractionResults = await this.llmManager.metaTextExtract(
        segments,
        this.config.messagesUse
      );

      // Track token usage
      for (const extraction of extractionResults) {
        if (extraction.usage) {
          this.tokenStats.addMemory.calls++;
          this.tokenStats.addMemory.promptTokens += extraction.usage.promptTokens;
          this.tokenStats.addMemory.completionTokens += extraction.usage.completionTokens;
          this.tokenStats.addMemory.totalTokens += extraction.usage.totalTokens;
        }

        result.addInputPrompt.push(JSON.stringify(extraction.inputPrompt));
        result.addOutputPrompt.push(extraction.outputPrompt);
        result.apiCallNums++;

        // Convert extracted facts to memory entries
        const memoryEntries = await this.createMemoryEntries(extraction, messagesToProcess);
        result.memoryEntriesCreated += memoryEntries.length;
      }
    }

    // Clear buffer after processing
    this.messageBuffer = [];

    this.logger.info(
      `[${callId}] Completed: ${result.memoryEntriesCreated} entries created, ${result.apiCallNums} API calls`
    );

    return result;
  }

  /**
   * Filter messages based on config
   */
  private filterMessagesByRole(messages: NormalizedMessage[]): NormalizedMessage[] {
    const roleFilter: Record<string, Set<string>> = {
      user_only: new Set(['user']),
      assistant_only: new Set(['assistant']),
      hybrid: new Set(['user', 'assistant']),
    };

    const allowedRoles = roleFilter[this.config.messagesUse];
    return messages.filter((msg) => allowedRoles.has(msg.role));
  }

  /**
   * Create memory entries from extraction results
   */
  private async createMemoryEntries(
    extraction: ExtractionResult,
    messages: NormalizedMessage[]
  ): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];

    for (const fact of extraction.cleanedResult) {
      // Find the source message
      const sourceMessage = messages.find(
        (msg) => msg.sequenceNumber !== undefined && Math.floor(msg.sequenceNumber / 2) === fact.sourceId
      );

      const entry = createMemoryEntry({
        memory: fact.fact,
        originalMemory: fact.fact,
        timeStamp: sourceMessage?.timeStamp || new Date().toISOString(),
        floatTimeStamp: sourceMessage ? new Date(sourceMessage.timeStamp).getTime() / 1000 : Date.now() / 1000,
        weekday: sourceMessage?.weekday || '',
        speakerId: sourceMessage?.speakerId || '',
        speakerName: sourceMessage?.speakerName || '',
      });

      // Generate embedding
      const embedding = await this.embedder.embed(entry.memory);

      // Store in vector store
      await this.vectorStore.insert(entry, embedding);

      entries.push(entry);
      this.logger.debug(`Created memory entry: ${entry.id}`);
    }

    return entries;
  }

  /**
   * Retrieve relevant memories based on query
   */
  async retrieve(
    query: string,
    limit = 10,
    filters?: RetrieveFilters
  ): Promise<string> {
    const callId = `retrieve_${Date.now()}`;
    this.logger.info(`[${callId}] Retrieving memories for query: "${query.slice(0, 50)}..."`);

    // Generate query embedding
    const queryEmbedding = await this.embedder.embed(query);

    // Search vector store
    const results = await this.vectorStore.search(queryEmbedding, limit, filters);

    this.logger.info(`[${callId}] Found ${results.length} results`);

    // Format results
    const formattedResults = results.map((r) => {
      const payload = r.payload;
      return `${payload.timeStamp} ${payload.weekday} ${payload.memory}`;
    });

    return formattedResults.join('\n');
  }

  /**
   * Construct update queue for all entries
   */
  async constructUpdateQueueAllEntries(
    topK = 20,
    keepTopN = 10
  ): Promise<void> {
    const callId = `constructQueue_${Date.now()}`;
    this.logger.info(`[${callId}] Constructing update queues (topK=${topK}, keepTopN=${keepTopN})`);

    const allEntries = await this.vectorStore.getAll(true);
    this.logger.info(`[${callId}] Retrieved ${allEntries.length} entries`);

    if (allEntries.length === 0) {
      this.logger.warn(`[${callId}] No entries found, skipping`);
      return;
    }

    let updatedCount = 0;

    for (const entry of allEntries) {
      if (!entry.embedding) continue;

      // Find similar entries with earlier timestamps
      const hits = await this.vectorStore.search(entry.embedding, topK, {
        floatTimeStamp: { lte: entry.floatTimeStamp },
      });

      // Filter out self and build candidates
      const candidates = hits
        .filter((h) => h.id !== entry.id)
        .slice(0, keepTopN)
        .map((h) => ({ id: h.id, score: h.score }));

      // Update the entry with the queue
      await this.vectorStore.update(entry.id, { updateQueue: candidates });
      updatedCount++;
    }

    this.logger.info(`[${callId}] Updated ${updatedCount} entries with update queues`);
  }

  /**
   * Perform offline updates for all entries
   */
  async offlineUpdateAllEntries(scoreThreshold = 0.9): Promise<void> {
    const callId = `offlineUpdate_${Date.now()}`;
    this.logger.info(`[${callId}] Starting offline update (scoreThreshold=${scoreThreshold})`);

    const allEntries = await this.vectorStore.getAll(true);
    this.logger.info(`[${callId}] Retrieved ${allEntries.length} entries`);

    if (allEntries.length === 0) {
      this.logger.warn(`[${callId}] No entries found, skipping`);
      return;
    }

    let processedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    for (const entry of allEntries) {
      // Find entries that have this entry in their update queue
      const candidateSources: MemoryEntry[] = [];

      for (const other of allEntries) {
        const queue = other.updateQueue || [];
        const candidate = queue.find((c) => c.id === entry.id && c.score >= scoreThreshold);
        if (candidate) {
          candidateSources.push(other);
        }
      }

      if (candidateSources.length === 0) continue;

      processedCount++;

      // Call LLM to decide action
      const result = await this.llmManager.callUpdateLlm(
        entry.memory,
        candidateSources.map((c) => c.memory)
      );

      // Track token usage
      if (result.usage) {
        this.tokenStats.update.calls++;
        this.tokenStats.update.promptTokens += result.usage.promptTokens;
        this.tokenStats.update.completionTokens += result.usage.completionTokens;
        this.tokenStats.update.totalTokens += result.usage.totalTokens;
      }

      // Apply action
      if (result.action === 'delete') {
        await this.vectorStore.delete(entry.id);
        deletedCount++;
        this.logger.debug(`[${callId}] Deleted entry: ${entry.id}`);
      } else if (result.action === 'update' && result.newMemory) {
        await this.vectorStore.update(entry.id, { memory: result.newMemory });
        updatedCount++;
        this.logger.debug(`[${callId}] Updated entry: ${entry.id}`);
      }
    }

    this.logger.info(
      `[${callId}] Completed: processed=${processedCount}, updated=${updatedCount}, deleted=${deletedCount}`
    );
  }

  /**
   * Get token usage statistics
   */
  getTokenStatistics(): TokenStats {
    const embedderStats = this.embedder.getStats();

    return {
      summary: {
        totalLlmCalls: this.tokenStats.addMemory.calls + this.tokenStats.update.calls,
        totalLlmTokens: this.tokenStats.addMemory.totalTokens + this.tokenStats.update.totalTokens,
        totalEmbeddingCalls: embedderStats.totalCalls,
        totalEmbeddingTokens: embedderStats.totalTokens,
      },
      llm: {
        addMemory: { ...this.tokenStats.addMemory },
        update: { ...this.tokenStats.update },
      },
      embedding: {
        totalCalls: embedderStats.totalCalls,
        totalTokens: embedderStats.totalTokens,
      },
    };
  }

  /**
   * Get the number of stored memories
   */
  async getMemoryCount(): Promise<number> {
    return this.vectorStore.count();
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.tursoClient.close();
  }
}
