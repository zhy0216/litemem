# Benchmark Setup Guide

## Prerequisites

- Bun runtime (v1.0+)
- OpenRouter API key (or OpenAI-compatible API)
- Git

## Step 1: Clone LoCoMo Dataset

```bash
cd benchmark
git clone https://github.com/snap-research/locomo.git
```

The benchmark data is at `locomo/data/locomo10.json`.

## Step 2: Configure API Keys

Copy the example config and add your credentials:

```bash
cp ../src/config.example.json config.json
```

Edit `config.json`:

```json
{
  "messagesUse": "hybrid",
  "metadataGenerate": true,
  "textSummary": false,
  "llm": {
    "apiKey": "sk-or-v1-your-openrouter-key",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "openai/gpt-4o-mini",
    "maxTokens": 4096
  },
  "embedder": {
    "apiKey": "sk-or-v1-your-openrouter-key",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "openai/text-embedding-3-small",
    "dimensions": 1536
  },
  "turso": {
    "url": "file:./benchmark.db"
  },
  "retrieveStrategy": "embedding",
  "update": "offline",
  "logging": {
    "level": "info"
  }
}
```

### API Provider Options

**OpenRouter (recommended)**
```json
{
  "apiKey": "sk-or-v1-xxx",
  "baseUrl": "https://openrouter.ai/api/v1",
  "model": "openai/gpt-4o-mini"
}
```

**OpenAI Direct**
```json
{
  "apiKey": "sk-xxx",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini"
}
```

**Local (Ollama)**
```json
{
  "apiKey": "ollama",
  "baseUrl": "http://localhost:11434/v1",
  "model": "llama3.2"
}
```

## Step 3: Database Setup

The benchmark uses a local SQLite database by default:

```json
{
  "turso": {
    "url": "file:./benchmark.db"
  }
}
```

For Turso cloud:

```json
{
  "turso": {
    "url": "libsql://your-db.turso.io",
    "authToken": "your-token"
  }
}
```

## Step 4: Verify Installation

```bash
# From project root
bun run benchmark/verify.ts
```

Expected output:
```
[✓] Config loaded
[✓] LoCoMo data found (10 conversations, 847 QA pairs)
[✓] LiteMemory initialized
[✓] Database connection OK
[✓] LLM connection OK
[✓] Embedder connection OK
Ready to run benchmark!
```

## Step 5: Run Benchmark

### Full Benchmark

```bash
bun run benchmark/run.ts
```

### Single Conversation

```bash
bun run benchmark/run.ts --conversation 0
```

### Specific Categories

```bash
bun run benchmark/run.ts --categories 1,2,3
```

### Dry Run (No API Calls)

```bash
bun run benchmark/run.ts --dry-run
```

## Output

Results are saved to `benchmark/results/`:

```
results/
├── run_20240131_120000/
│   ├── summary.json       # Overall metrics
│   ├── detailed.json      # Per-question results
│   ├── errors.json        # Failed questions
│   └── token_usage.json   # API usage breakdown
```

## Troubleshooting

### "Cannot find module" errors

```bash
# Reinstall dependencies
cd .. && bun install
```

### API rate limits

Reduce parallelism in config:

```json
{
  "benchmark": {
    "concurrency": 1,
    "delayMs": 1000
  }
}
```

### Memory issues with large conversations

Process one conversation at a time:

```bash
for i in {0..9}; do
  bun run benchmark/run.ts --conversation $i
done
```

### Database locked errors

Ensure no other processes are using the benchmark database:

```bash
rm benchmark/benchmark.db*
```

## Cost Estimation

For the full LoCoMo benchmark (10 conversations, ~847 QA pairs):

| Model | Estimated Cost |
|-------|---------------|
| gpt-4o-mini | ~$2-5 |
| gpt-4o | ~$20-40 |
| claude-3-haiku | ~$1-3 |

Token usage varies based on:
- Number of memories extracted per conversation
- Retrieval limit per question
- Answer generation length
