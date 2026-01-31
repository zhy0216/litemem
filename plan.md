# LiteMem TypeScript + Turso Reimplementation Plan

## Overview

Reimplement the LiteMem long-term memory management framework from Python to TypeScript, using Turso (libSQL) as the primary database instead of Qdrant for vector storage.

## Architecture Decisions

### Technology Stack
- **Language**: TypeScript
- **Runtime**: Bun
- **Database**: Turso (libSQL) with vector extension
- **LLM Backend**: OpenRouter (OpenAI-compatible API, access to multiple models)
- **Embeddings**: OpenRouter or dedicated embedding service
- **MCP Server**: @modelcontextprotocol/sdk

*Note: No runtime schema validation library needed - TypeScript's static type system provides sufficient type safety.*

### Key Differences from Python Implementation
1. **Vector Storage**: Turso with `sqlite-vec` extension instead of Qdrant
2. **Simplified Factory Pattern**: TypeScript interfaces with dependency injection
3. **LLM Backend**: OpenRouter for multi-model access (vs direct OpenAI/DeepSeek/etc.)
4. **No Pre-compression**: LLMLingua-2 not available in JS; defer to future
5. **No Topic Segmentation Initially**: Requires ML models; use simpler chunking
6. **No Runtime Validation**: TypeScript types replace Pydantic; config is typed interfaces

---

## Project Structure

```
src/
├── index.ts                    # Main exports
├── liteMem.ts                  # Core LiteMemory class
├── types/
│   ├── index.ts               # Type exports
│   ├── config.ts              # Zod schemas for configuration
│   ├── memory.ts              # MemoryEntry interface
│   └── messages.ts            # Message types
├── storage/
│   ├── index.ts               # Storage exports
│   ├── turso.ts               # Turso client wrapper
│   └── vector-store.ts        # Vector operations with sqlite-vec
├── llm/
│   ├── index.ts               # LLM exports
│   ├── base.ts                # Base LLM interface
│   ├── openrouter.ts          # OpenRouter implementation
│   └── prompts.ts             # Extraction and update prompts
├── embeddings/
│   ├── index.ts               # Embeddings exports
│   ├── base.ts                # Base embedder interface
│   └── openrouter.ts          # OpenRouter embeddings
├── retriever/
│   ├── index.ts               # Retriever exports
│   ├── embedding.ts           # Vector similarity search
│   └── context.ts             # BM25/keyword search (optional)
├── buffer/
│   ├── index.ts               # Buffer exports
│   └── short-term.ts          # Short-term memory buffer
├── utils/
│   ├── index.ts               # Utility exports
│   ├── normalizer.ts          # Message normalization
│   ├── tokenizer.ts           # Token counting (tiktoken)
│   └── logger.ts              # Logging utility
└── mcp/
    └── server.ts              # MCP server implementation
```

---

## Phase 1: Foundation

### 1.1 Project Setup
- Initialize Bun project with TypeScript
- Configure tsconfig.json for ES modules
- Add dependencies:
  - `@libsql/client` - Turso client
  - `openai` - OpenAI SDK (used with OpenRouter base URL)
  - `tiktoken` - Token counting
  - `@modelcontextprotocol/sdk` - MCP server

### 1.2 Type Definitions

**MemoryEntry Interface** (from `utils.py:MemoryEntry`):
```typescript
interface MemoryEntry {
  id: string;
  timeStamp: string;          // ISO format
  floatTimeStamp: number;     // Unix timestamp
  weekday: string;
  category: string;
  subcategory: string;
  memoryClass: string;
  memory: string;             // Processed fact
  originalMemory: string;
  compressedMemory: string;
  topicId: number | null;
  topicSummary: string;
  speakerId: string;
  speakerName: string;
  hitTime: number;
  updateQueue: UpdateCandidate[];
}

interface UpdateCandidate {
  id: string;
  score: number;
}
```

**Configuration Interface** (TypeScript, from `configs/base.py`):
```typescript
interface LiteMemConfig {
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

interface OpenRouterConfig {
  apiKey: string;
  baseUrl?: string;  // defaults to https://openrouter.ai/api/v1
  model: string;     // e.g., 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini'
  maxTokens?: number;
}

// Default config factory
function createDefaultConfig(overrides?: Partial<LiteMemConfig>): LiteMemConfig {
  return {
    messagesUse: 'user_only',
    metadataGenerate: true,
    textSummary: true,
    retrieveStrategy: 'embedding',
    update: 'offline',
    ...overrides,
  } as LiteMemConfig;
}
```

### 1.3 Turso Storage Setup

**Schema Design**:
```sql
-- Memory entries table
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
  updateQueue TEXT,  -- JSON array
  embedding F32_BLOB(384),  -- Vector for sqlite-vec
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Create vector index
CREATE INDEX IF NOT EXISTS memoriesEmbeddingIdx
ON memories(libsql_vector_idx(embedding));
```

---

## Phase 2: Core Components

### 2.1 Message Normalizer
Port `MessageNormalizer` class from `lightmem.py:27-103`:
- Parse session timestamps
- Normalize message format
- Add session_time, weekday fields
- Handle incrementing timestamps within sessions

### 2.2 LLM Manager (OpenRouter)
Port from `factory/memory_manager/openai.py`:
- Initialize OpenAI client with OpenRouter base URL (`https://openrouter.ai/api/v1`)
- Configure model selection (e.g., `anthropic/claude-3.5-sonnet`, `openai/gpt-4o-mini`)
- `metaTextExtract()` - Extract facts from messages using prompt
- `callUpdateLlm()` - Update/merge memory entries
- Token tracking for API usage

### 2.3 Text Embedder (OpenRouter)
Create embedding generator:
- Use OpenRouter's embedding models or fallback to OpenAI-compatible endpoint
- Batch embedding support
- Caching for repeated queries

### 2.4 Vector Store Operations
Implement vector operations using Turso + sqlite-vec:
- `insert(entry, embedding)` - Insert with vector
- `search(queryVector, limit, filters)` - Cosine similarity search
- `update(id, entry, embedding)` - Update entry
- `delete(id)` - Remove entry
- `getAll()` - Retrieve all entries
- `exists(id)` - Check existence

---

## Phase 3: Main LiteMemory Class

### 3.1 Core Methods (from `lightmem.py:106-702`)

```typescript
class LiteMemory {
  constructor(config: LiteMemConfig)
  static fromConfig(config: Record<string, unknown>): LiteMemory

  // Main pipeline
  async addMemory(messages: Message[], options?: AddMemoryOptions): Promise<AddMemoryResult>

  // Retrieval
  async retrieve(query: string, limit?: number, filters?: Filters): Promise<string>

  // Offline updates
  async constructUpdateQueueAllEntries(topK?: number, keepTopN?: number): Promise<void>
  async offlineUpdateAllEntries(scoreThreshold?: number): Promise<void>

  // Statistics
  getTokenStatistics(): TokenStats
}
```

### 3.2 Add Memory Pipeline
1. Normalize messages with timestamps
2. (Skip compression - not available in JS)
3. (Skip topic segmentation initially - use simple chunking)
4. Buffer messages until extraction threshold
5. Call LLM for fact extraction using `METADATA_GENERATE_PROMPT`
6. Convert results to MemoryEntry objects
7. Generate embeddings
8. Store in Turso with vectors

### 3.3 Retrieval Pipeline
1. Generate query embedding
2. Perform vector similarity search in Turso
3. Apply filters if provided
4. Format and return results

### 3.4 Update Pipeline
1. Get all entries from database
2. For each entry, find similar entries (by vector)
3. Build update queue with candidates
4. Call LLM with `UPDATE_PROMPT` to decide: update/delete/ignore
5. Apply changes to database

---

## Phase 4: MCP Server

### 4.1 Tools (from `mcp/server.py`)

```typescript
// Tool definitions
const tools = {
  getTimestamp: () => Promise<{ status: string; message: string }>,

  addMemory: (params: {
    userInput: string;
    assistantReply: string;
    timestamp?: string;
    forceExtract?: boolean;
  }) => Promise<AddMemoryToolResult>,

  retrieveMemory: (params: {
    query: string;
    limit?: number;
    filters?: Record<string, unknown>;
  }) => Promise<RetrieveMemoryToolResult>,

  offlineUpdate: (params: {
    topK?: number;
    keepTopN?: number;
    scoreThreshold?: number;
  }) => Promise<OfflineUpdateToolResult>,

  showLitememInstance: () => Promise<ShowInstanceToolResult>,
};
```

### 4.2 Server Configuration
- Load config from JSON file
- Lazy initialization of LiteMemory instance
- Transport support: stdio, HTTP

---

## Phase 5: Testing & Documentation

### 5.1 Unit Tests (using `bun test`)
- Config validation
- Message normalization
- Vector operations
- LLM integration (mocked)
- MCP tool handlers

### 5.2 Integration Tests
- Full addMemory → retrieve cycle
- Offline update workflow
- MCP server end-to-end

---

## Implementation Tasks

### Task 1: Project Foundation ✅
- [x] Initialize Bun project (`bun init`)
- [x] Configure TypeScript
- [x] Add all dependencies
- [x] Set up file structure

### Task 2: Type System ✅
- [x] Define MemoryEntry interface
- [x] Create config interfaces with defaults
- [x] Define message types
- [x] Export all types

### Task 3: Turso Storage Layer ✅
- [x] Create Turso client wrapper
- [x] Implement database initialization
- [x] Add vector store operations (CRUD)
- [x] Test vector similarity search

### Task 4: LLM Integration ✅
- [x] Create OpenRouter manager (using OpenAI SDK with custom base URL)
- [x] Port extraction prompts
- [x] Implement metaTextExtract
- [x] Implement callUpdateLlm
- [x] Add token tracking

### Task 5: Embeddings ✅
- [x] Create OpenRouter/compatible embedder
- [x] Implement batch embedding
- [x] Add caching layer

### Task 6: Core LiteMemory ✅
- [x] Port MessageNormalizer
- [x] Implement constructor and fromConfig
- [x] Implement addMemory pipeline
- [x] Implement retrieve method
- [x] Implement offline update methods
- [x] Add token statistics

### Task 7: MCP Server ✅
- [x] Set up MCP SDK
- [x] Define tool schemas
- [x] Implement tool handlers
- [x] Add configuration loading
- [ ] Test with MCP inspector

### Task 8: Testing (TODO)
- [ ] Write unit tests with `bun test`
- [ ] Write integration tests
- [ ] Document usage

---

## Dependencies

```json
{
  "dependencies": {
    "@libsql/client": "^0.6.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "openai": "^4.0.0",
    "tiktoken": "^1.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  }
}
```

*Notes:*
- *Bun has built-in UUID generation (`crypto.randomUUID()`), test runner, and TypeScript support.*
- *OpenAI SDK is used with OpenRouter's base URL (`https://openrouter.ai/api/v1`) for multi-model access.*

---

## Notes

### Deferred Features (Future Work)
1. **Pre-compression**: LLMLingua-2 is Python-only; consider alternatives
2. **Topic Segmentation**: Requires ML models; use simple chunking for now
3. **BM25 Context Retriever**: Optional, vector search is primary
4. **Graph Memory**: Complex feature, defer to later version

### Vector Search with Turso
Turso supports vectors via `sqlite-vec` extension:
- Store embeddings as `F32_BLOB(N)` type
- Use `vec_distance_cosine()` for similarity
- Create index with `libsql_vector_idx()`

Example query:
```sql
SELECT id, memory, vec_distance_cosine(embedding, ?) as distance
FROM memories
ORDER BY distance ASC
LIMIT 10;
```
