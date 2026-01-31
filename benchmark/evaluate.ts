/**
 * QA Evaluation metrics for LoCoMo benchmark
 */

import type { MemoryEntry } from '../src/types';
import type { LocomoQA, MessageWithSource } from './convert';

export interface EvaluationResult {
  questionId: number;
  question: string;
  category: number;
  groundTruth: string;
  predicted: string;
  exactMatch: boolean;
  fuzzyMatch: boolean;
  evidenceRecall: number;
  retrievedCount: number;
}

export interface CategoryMetrics {
  category: number;
  totalQuestions: number;
  exactMatchCount: number;
  fuzzyMatchCount: number;
  avgEvidenceRecall: number;
  exactMatchRate: number;
  fuzzyMatchRate: number;
}

export interface BenchmarkSummary {
  totalQuestions: number;
  overallExactMatch: number;
  overallFuzzyMatch: number;
  avgEvidenceRecall: number;
  byCategory: CategoryMetrics[];
  totalTokens: {
    llm: number;
    embedding: number;
  };
  totalTimeMs: number;
}

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Check exact match (after normalization)
 */
export function checkExactMatch(predicted: string, groundTruth: string): boolean {
  return normalizeText(predicted) === normalizeText(String(groundTruth));
}

/**
 * Check fuzzy match (predicted contains ground truth or vice versa)
 */
export function checkFuzzyMatch(predicted: string, groundTruth: string): boolean {
  const normPred = normalizeText(predicted);
  const normTruth = normalizeText(String(groundTruth));

  return normPred.includes(normTruth) || normTruth.includes(normPred);
}

/**
 * Calculate evidence recall
 * How many of the ground-truth evidence dialog IDs are covered by retrieved memories
 */
export function calculateEvidenceRecall(
  retrievedMemories: MemoryEntry[],
  evidenceIds: string[],
  dialogIdMap: Map<string, string[]> // memory_id -> [dialog_ids]
): number {
  if (evidenceIds.length === 0) return 1.0;

  const coveredIds = new Set<string>();

  for (const memory of retrievedMemories) {
    const sourceIds = dialogIdMap.get(memory.id);
    if (sourceIds) {
      for (const id of sourceIds) {
        if (evidenceIds.includes(id)) {
          coveredIds.add(id);
        }
      }
    }
  }

  return coveredIds.size / evidenceIds.length;
}

/**
 * Evaluate a single QA pair
 */
export function evaluateQA(
  qa: LocomoQA,
  predicted: string,
  retrievedMemories: MemoryEntry[],
  dialogIdMap: Map<string, string[]>,
  questionId: number
): EvaluationResult {
  const exactMatch = checkExactMatch(predicted, String(qa.answer));
  const fuzzyMatch = checkFuzzyMatch(predicted, String(qa.answer));
  const evidenceRecall = calculateEvidenceRecall(
    retrievedMemories,
    qa.evidence,
    dialogIdMap
  );

  return {
    questionId,
    question: qa.question,
    category: qa.category,
    groundTruth: String(qa.answer),
    predicted,
    exactMatch,
    fuzzyMatch,
    evidenceRecall,
    retrievedCount: retrievedMemories.length,
  };
}

/**
 * Calculate metrics by category
 */
export function calculateCategoryMetrics(
  results: EvaluationResult[]
): CategoryMetrics[] {
  const byCategory = new Map<number, EvaluationResult[]>();

  for (const r of results) {
    const existing = byCategory.get(r.category) || [];
    existing.push(r);
    byCategory.set(r.category, existing);
  }

  const metrics: CategoryMetrics[] = [];

  for (const [category, categoryResults] of byCategory) {
    const exactMatchCount = categoryResults.filter((r) => r.exactMatch).length;
    const fuzzyMatchCount = categoryResults.filter((r) => r.fuzzyMatch).length;
    const avgEvidenceRecall =
      categoryResults.reduce((sum, r) => sum + r.evidenceRecall, 0) /
      categoryResults.length;

    metrics.push({
      category,
      totalQuestions: categoryResults.length,
      exactMatchCount,
      fuzzyMatchCount,
      avgEvidenceRecall,
      exactMatchRate: exactMatchCount / categoryResults.length,
      fuzzyMatchRate: fuzzyMatchCount / categoryResults.length,
    });
  }

  return metrics.sort((a, b) => a.category - b.category);
}

/**
 * Generate benchmark summary
 */
export function generateSummary(
  results: EvaluationResult[],
  tokenStats: { llm: number; embedding: number },
  timeMs: number
): BenchmarkSummary {
  const exactMatchCount = results.filter((r) => r.exactMatch).length;
  const fuzzyMatchCount = results.filter((r) => r.fuzzyMatch).length;
  const avgEvidenceRecall =
    results.reduce((sum, r) => sum + r.evidenceRecall, 0) / results.length;

  return {
    totalQuestions: results.length,
    overallExactMatch: exactMatchCount / results.length,
    overallFuzzyMatch: fuzzyMatchCount / results.length,
    avgEvidenceRecall,
    byCategory: calculateCategoryMetrics(results),
    totalTokens: tokenStats,
    totalTimeMs: timeMs,
  };
}

/**
 * Format summary for display
 */
export function formatSummary(summary: BenchmarkSummary): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('                  BENCHMARK RESULTS                        ');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('OVERALL METRICS');
  lines.push('───────────────────────────────────────────────────────────');
  lines.push(`  Total Questions:    ${summary.totalQuestions}`);
  lines.push(`  Exact Match Rate:   ${(summary.overallExactMatch * 100).toFixed(1)}%`);
  lines.push(`  Fuzzy Match Rate:   ${(summary.overallFuzzyMatch * 100).toFixed(1)}%`);
  lines.push(`  Avg Evidence Recall: ${(summary.avgEvidenceRecall * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('BY CATEGORY');
  lines.push('───────────────────────────────────────────────────────────');
  lines.push('  Cat  Questions  Exact%   Fuzzy%   Evidence%');
  lines.push('  ---  ---------  ------   ------   ---------');

  for (const cat of summary.byCategory) {
    lines.push(
      `   ${cat.category}      ${String(cat.totalQuestions).padStart(4)}     ` +
        `${(cat.exactMatchRate * 100).toFixed(1).padStart(5)}%   ` +
        `${(cat.fuzzyMatchRate * 100).toFixed(1).padStart(5)}%    ` +
        `${(cat.avgEvidenceRecall * 100).toFixed(1).padStart(5)}%`
    );
  }

  lines.push('');
  lines.push('RESOURCE USAGE');
  lines.push('───────────────────────────────────────────────────────────');
  lines.push(`  LLM Tokens:       ${summary.totalTokens.llm.toLocaleString()}`);
  lines.push(`  Embedding Tokens: ${summary.totalTokens.embedding.toLocaleString()}`);
  lines.push(`  Total Time:       ${(summary.totalTimeMs / 1000).toFixed(1)}s`);
  lines.push('═══════════════════════════════════════════════════════════');

  return lines.join('\n');
}
