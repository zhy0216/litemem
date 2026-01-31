import { NormalizedMessage } from '../types/messages';
import { estimateTokenCount } from '../utils/tokenizer';

/**
 * Short-term memory buffer for collecting messages before extraction
 *
 * TODO: Implement proper topic segmentation for smarter batching
 */
export class ShortTermBuffer {
  private buffer: NormalizedMessage[] = [];
  private maxTokens: number;
  private currentTokens = 0;

  constructor(maxTokens = 2000) {
    this.maxTokens = maxTokens;
  }

  /**
   * Add messages to the buffer
   * Returns true if buffer is ready for extraction
   */
  add(messages: NormalizedMessage[]): boolean {
    for (const msg of messages) {
      const tokens = estimateTokenCount(msg.content);
      this.buffer.push(msg);
      this.currentTokens += tokens;
    }

    return this.currentTokens >= this.maxTokens;
  }

  /**
   * Get all buffered messages and clear the buffer
   */
  flush(): NormalizedMessage[] {
    const messages = [...this.buffer];
    this.buffer = [];
    this.currentTokens = 0;
    return messages;
  }

  /**
   * Get current buffer without clearing
   */
  peek(): NormalizedMessage[] {
    return [...this.buffer];
  }

  /**
   * Get current token count
   */
  getTokenCount(): number {
    return this.currentTokens;
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = [];
    this.currentTokens = 0;
  }
}
