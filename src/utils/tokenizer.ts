// TODO: Integrate tiktoken for accurate token counting
// For now, use a simple approximation based on character count

/**
 * Approximate token count for text
 * Uses a simple heuristic: ~4 characters per token on average
 */
export function estimateTokenCount(text: string): number {
  // Rough approximation: English text averages ~4 chars per token
  // This is a simplification; real tokenization varies by model
  return Math.ceil(text.length / 4);
}

/**
 * Check if text exceeds token limit
 */
export function exceedsTokenLimit(text: string, limit: number): boolean {
  return estimateTokenCount(text) > limit;
}

/**
 * Truncate text to approximate token limit
 */
export function truncateToTokenLimit(text: string, limit: number): string {
  const approxChars = limit * 4;
  if (text.length <= approxChars) {
    return text;
  }
  return text.slice(0, approxChars) + '...';
}
