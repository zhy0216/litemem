/**
 * LiteMemory + LoCoMo Benchmark Runner
 *
 * Usage:
 *   bun run benchmark/run.ts                      # Run full benchmark
 *   bun run benchmark/run.ts --conversation 0    # Single conversation
 *   bun run benchmark/run.ts --categories 1,2    # Specific categories
 *   bun run benchmark/run.ts --dry-run           # Test without API calls
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

import { LiteMemory, createDefaultConfig } from '../src';
import type { LiteMemConfig } from '../src/types';

import {
  loadLocomoData,
  convertConversationToMessages,
  toStandardMessages,
  getDatasetStats,
  type LocomoSample,
  type LocomoQA,
  type MessageWithSource,
} from './convert';

import {
  checkExactMatch,
  checkFuzzyMatch,
  generateSummary,
  formatSummary,
  type EvaluationResult,
  type BenchmarkSummary,
} from './evaluate';

// Simplified evaluation without evidence tracking
// (Full evidence tracking requires extending LiteMemory.retrieve to return MemoryEntry[])
function evaluateQASimple(
  qa: LocomoQA,
  predicted: string,
  memoriesText: string,
  questionId: number
): EvaluationResult {
  const exactMatch = checkExactMatch(predicted, String(qa.answer));
  const fuzzyMatch = checkFuzzyMatch(predicted, String(qa.answer));

  // Count memories by splitting on newlines (rough estimate)
  const retrievedCount = memoriesText ? memoriesText.split('\n').filter(Boolean).length : 0;

  return {
    questionId,
    question: qa.question,
    category: qa.category,
    groundTruth: String(qa.answer),
    predicted,
    exactMatch,
    fuzzyMatch,
    evidenceRecall: 0, // TODO: Requires extending retrieve() to return MemoryEntry[]
    retrievedCount,
  };
}

// Configuration
interface BenchmarkConfig extends LiteMemConfig {
  benchmark: {
    conversationIndices: number[];
    categories: number[];
    retrieveLimit: number;
    forceExtract: boolean;
    concurrency: number;
    delayMs: number;
    answerModel?: string;
  };
}

// Parse CLI arguments
function parseArgs(): {
  configPath: string;
  conversation?: number;
  categories?: number[];
  dryRun: boolean;
  verbose: boolean;
} {
  const args = process.argv.slice(2);
  const result = {
    configPath: 'benchmark/config.json',
    conversation: undefined as number | undefined,
    categories: undefined as number[] | undefined,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' && args[i + 1]) {
      result.configPath = args[++i];
    } else if (arg === '--conversation' && args[i + 1]) {
      result.conversation = parseInt(args[++i]);
    } else if (arg === '--categories' && args[i + 1]) {
      result.categories = args[++i].split(',').map(Number);
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    }
  }

  return result;
}

// Load configuration
function loadConfig(path: string): BenchmarkConfig {
  const raw = readFileSync(path, 'utf-8');
  const config = JSON.parse(raw);

  // Set defaults for benchmark section
  config.benchmark = {
    conversationIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    categories: [1, 2, 3, 4, 5],
    retrieveLimit: 10,
    forceExtract: true,
    concurrency: 1,
    delayMs: 500,
    ...config.benchmark,
  };

  return config as BenchmarkConfig;
}

// Generate answer from retrieved memories
async function generateAnswer(
  question: string,
  memoriesText: string, // Formatted string from retrieve()
  liteMem: LiteMemory,
  config: BenchmarkConfig
): Promise<string> {
  const prompt = `Based on the following memories from a conversation, answer the question concisely.

Memories:
${memoriesText || '(No relevant memories found)'}

Question: ${question}

Answer (be brief and direct):`;

  // Use the LLM manager to generate response
  // @ts-ignore - accessing internal for benchmark
  const llmManager = liteMem['llmManager'];
  const result = await llmManager.generateResponse([
    { role: 'user', content: prompt },
  ]);

  return result.response.trim();
}

// Process a single conversation
async function processConversation(
  sample: LocomoSample,
  config: BenchmarkConfig,
  dryRun: boolean,
  verbose: boolean
): Promise<{
  results: EvaluationResult[];
  dialogIdMap: Map<string, string[]>;
  tokenStats: { llm: number; embedding: number };
}> {
  const results: EvaluationResult[] = [];
  const dialogIdMap = new Map<string, string[]>();

  console.log(`\n[Conversation ${sample.sample_id}] Processing...`);

  // Convert conversation to messages
  const messagesWithSource = convertConversationToMessages(sample.conversation);
  const messages = toStandardMessages(messagesWithSource);

  console.log(`  ${messages.length} dialog turns`);

  if (dryRun) {
    console.log('  [DRY RUN] Skipping memory ingestion');
    return { results, dialogIdMap, tokenStats: { llm: 0, embedding: 0 } };
  }

  // Create fresh LiteMemory instance for this conversation
  const dbPath = `file:./benchmark/db_conv_${sample.sample_id}.db`;
  const liteMem = new LiteMemory(
    createDefaultConfig({
      ...config,
      turso: { url: dbPath },
    })
  );

  await liteMem.initialize();

  // Ingest conversation
  console.log('  Ingesting memories...');
  const ingestResult = await liteMem.addMemory(messages, {
    forceExtract: config.benchmark.forceExtract,
  });
  console.log(`  Created ${ingestResult.memoryEntriesCreated} memories`);

  // Build dialog ID map (simplified - track by sequence)
  // In a full implementation, this would track which dialog turns contributed to each memory
  const memoryCount = await liteMem.getMemoryCount();

  // Filter QA by categories
  const qaList = sample.qa.filter((qa) =>
    config.benchmark.categories.includes(qa.category)
  );
  console.log(`  Evaluating ${qaList.length} questions (categories: ${config.benchmark.categories.join(',')})`);

  // Evaluate each question
  for (let i = 0; i < qaList.length; i++) {
    const qa = qaList[i];

    if (verbose) {
      console.log(`    Q${i + 1}: ${qa.question.slice(0, 50)}...`);
    }

    // Retrieve relevant memories (returns formatted string)
    const memoriesText = await liteMem.retrieve(
      qa.question,
      config.benchmark.retrieveLimit
    );

    // Generate answer
    const predicted = await generateAnswer(qa.question, memoriesText, liteMem, config);

    if (verbose) {
      console.log(`      A: ${predicted.slice(0, 50)}... (truth: ${String(qa.answer).slice(0, 30)})`);
    }

    // Evaluate (simplified - evidence recall requires API extension)
    const result = evaluateQASimple(qa, predicted, memoriesText, i);
    results.push(result);

    // Rate limiting
    if (config.benchmark.delayMs > 0) {
      await new Promise((r) => setTimeout(r, config.benchmark.delayMs));
    }
  }

  // Get token stats
  const stats = liteMem.getTokenStatistics();
  const tokenStats = {
    llm: stats.llm.addMemory.totalTokens + stats.llm.update.totalTokens,
    embedding: stats.embedding.totalTokens || 0,
  };

  await liteMem.close();

  return { results, dialogIdMap, tokenStats };
}

// Save results
function saveResults(
  summary: BenchmarkSummary,
  results: EvaluationResult[],
  outputDir: string
): void {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(
    join(outputDir, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  writeFileSync(
    join(outputDir, 'detailed.json'),
    JSON.stringify(results, null, 2)
  );

  const errors = results.filter((r) => !r.exactMatch && !r.fuzzyMatch);
  writeFileSync(join(outputDir, 'errors.json'), JSON.stringify(errors, null, 2));

  console.log(`\nResults saved to ${outputDir}/`);
}

// Main
async function main(): Promise<void> {
  const args = parseArgs();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('          LiteMemory + LoCoMo Benchmark                    ');
  console.log('═══════════════════════════════════════════════════════════');

  // Load config
  let config: BenchmarkConfig;
  try {
    config = loadConfig(args.configPath);
    console.log(`Config loaded from ${args.configPath}`);
  } catch (err) {
    console.error(`Error loading config from ${args.configPath}`);
    console.log('Create benchmark/config.json based on src/config.example.json');
    process.exit(1);
  }

  // Override from CLI
  if (args.conversation !== undefined) {
    config.benchmark.conversationIndices = [args.conversation];
  }
  if (args.categories) {
    config.benchmark.categories = args.categories;
  }

  // Load LoCoMo data
  const dataPath = 'benchmark/locomo/data/locomo10.json';
  let data: LocomoSample[];
  try {
    data = loadLocomoData(dataPath);
    const stats = getDatasetStats(data);
    console.log(`LoCoMo data loaded: ${stats.conversations} conversations, ${stats.totalQA} QA pairs`);
  } catch (err) {
    console.error(`Error loading LoCoMo data from ${dataPath}`);
    console.log('Run: git clone https://github.com/snap-research/locomo.git benchmark/locomo');
    process.exit(1);
  }

  // Run benchmark
  const startTime = Date.now();
  const allResults: EvaluationResult[] = [];
  let totalLlmTokens = 0;
  let totalEmbeddingTokens = 0;

  for (const idx of config.benchmark.conversationIndices) {
    if (idx < 0 || idx >= data.length) {
      console.warn(`Skipping invalid conversation index: ${idx}`);
      continue;
    }

    const { results, tokenStats } = await processConversation(
      data[idx],
      config,
      args.dryRun,
      args.verbose
    );

    allResults.push(...results);
    totalLlmTokens += tokenStats.llm;
    totalEmbeddingTokens += tokenStats.embedding;
  }

  const endTime = Date.now();

  // Generate summary
  if (allResults.length > 0) {
    const summary = generateSummary(
      allResults,
      { llm: totalLlmTokens, embedding: totalEmbeddingTokens },
      endTime - startTime
    );

    console.log('\n' + formatSummary(summary));

    // Save results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputDir = `benchmark/results/run_${timestamp}`;
    saveResults(summary, allResults, outputDir);
  } else {
    console.log('\nNo results to summarize (dry run or no questions evaluated)');
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
