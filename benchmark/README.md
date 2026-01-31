# LiteMemory + LoCoMo Benchmark

This directory contains guides and tools for evaluating LiteMemory against the [LoCoMo benchmark](https://github.com/snap-research/locomo) - a long-term conversational memory evaluation dataset from ACL 2024.

## Overview

LoCoMo tests how well memory systems retain and retrieve information from extended conversations spanning multiple sessions. It provides:

- **10 annotated conversations** with multi-session dialogues
- **Question-answering tasks** with ground-truth answers and evidence
- **5 QA categories** testing different reasoning complexities
- **Event summarization** ground truth per speaker

## Quick Start

```bash
# 1. Clone LoCoMo data
git clone https://github.com/snap-research/locomo.git benchmark/locomo

# 2. Install dependencies
bun install

# 3. Set up configuration
cp src/config.example.json benchmark/config.json
# Edit benchmark/config.json with your API keys

# 4. Run benchmark
bun run benchmark/run.ts
```

## Directory Structure

```
benchmark/
├── README.md           # This file
├── SETUP.md            # Detailed setup instructions
├── DATA_FORMAT.md      # LoCoMo data format reference
├── config.json         # Benchmark configuration (gitignored)
├── run.ts              # Main benchmark runner
├── convert.ts          # LoCoMo → LiteMemory format converter
├── evaluate.ts         # QA evaluation metrics
└── locomo/             # Cloned LoCoMo repository (gitignored)
```

## Benchmark Process

### 1. Data Ingestion

Convert LoCoMo conversations to LiteMemory message format and ingest:

```typescript
import { convertLocomoToMessages } from './convert';
import { LiteMemory } from '../src';

// Load and convert a conversation
const conversation = loadLocomoConversation('locomo/data/locomo10.json', 0);
const messages = convertLocomoToMessages(conversation);

// Ingest into LiteMemory
const liteMem = new LiteMemory(config);
await liteMem.initialize();
await liteMem.addMemory(messages, { forceExtract: true });
```

### 2. QA Evaluation

For each question, retrieve memories and evaluate against ground truth:

```typescript
const questions = loadLocomoQuestions('locomo/data/locomo10.json', 0);

for (const qa of questions) {
  // Retrieve relevant memories
  const memories = await liteMem.retrieve(qa.question, 10);

  // Generate answer using retrieved context
  const answer = await generateAnswer(qa.question, memories);

  // Compare with ground truth
  const score = evaluateAnswer(answer, qa.answer, qa.category);
}
```

### 3. Metrics

The benchmark tracks:

| Metric | Description |
|--------|-------------|
| **QA Accuracy** | Exact/fuzzy match against ground truth answers |
| **Evidence Recall** | Whether retrieved memories cover evidence dialog IDs |
| **Category Breakdown** | Accuracy per QA category (1-5) |
| **Token Usage** | LLM and embedding tokens consumed |
| **Latency** | Time for ingestion and retrieval |

## QA Categories

| Category | Description | Example |
|----------|-------------|---------|
| 1 | Single-session, explicit | "What restaurant did they go to?" |
| 2 | Single-session, requires inference | "When did X happen?" |
| 3 | Multi-session reasoning | "How did their opinion change?" |
| 4 | Temporal reasoning | "What happened before Y?" |
| 5 | Adversarial (with distractor) | Questions with misleading context |

## Configuration

Create `benchmark/config.json`:

```json
{
  "llm": {
    "apiKey": "your-openrouter-api-key",
    "model": "openai/gpt-4o-mini"
  },
  "embedder": {
    "apiKey": "your-openrouter-api-key",
    "model": "openai/text-embedding-3-small"
  },
  "turso": {
    "url": "file:./benchmark/benchmark.db"
  },
  "benchmark": {
    "conversationIndices": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    "retrieveLimit": 10,
    "forceExtract": true
  }
}
```

## Expected Results

Based on LoCoMo paper baselines, memory-augmented systems typically achieve:

- Category 1-2: 60-80% accuracy
- Category 3-4: 40-60% accuracy
- Category 5: 30-50% accuracy (adversarial)

LiteMemory's semantic extraction should perform well on categories requiring inference (2-4) compared to raw dialog retrieval.

## Related Resources

- [LoCoMo Paper (ACL 2024)](https://arxiv.org/abs/2402.17753)
- [LoCoMo GitHub](https://github.com/snap-research/locomo)
- [LiteMemory Documentation](../README.md)
