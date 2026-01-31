import OpenAI from 'openai';
import { OpenRouterConfig, OPENROUTER_BASE_URL } from '../types/config';
import { NormalizedMessage, ExtractedFact } from '../types/messages';
import { UsageInfo, cleanResponse, createOpenRouterClient } from './base';
import { METADATA_GENERATE_PROMPT, UPDATE_PROMPT } from './prompts';

/**
 * Result from metadata extraction
 */
export interface ExtractionResult {
  inputPrompt: Array<{ role: string; content: string }>;
  outputPrompt: string;
  cleanedResult: ExtractedFact[];
  usage: UsageInfo | null;
}

/**
 * Result from update LLM call
 */
export interface UpdateResult {
  action: 'update' | 'delete' | 'ignore';
  newMemory?: string;
  usage: UsageInfo | null;
}

/**
 * OpenRouter LLM manager for memory extraction and updates
 */
export class OpenRouterManager {
  private client: OpenAI;
  private config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
    this.config = config;
    this.client = createOpenRouterClient(config);
  }

  /**
   * Generate a response from the LLM
   */
  async generateResponse(
    messages: Array<{ role: string; content: string }>,
    responseFormat?: { type: string }
  ): Promise<{ response: string; usage: UsageInfo }> {
    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: this.config.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      max_tokens: this.config.maxTokens || 4096,
    };

    if (responseFormat) {
      params.response_format = responseFormat as OpenAI.ResponseFormatJSONObject;
    }

    const response = await this.client.chat.completions.create(params);

    const usage: UsageInfo = {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    };

    return {
      response: response.choices[0]?.message?.content || '',
      usage,
    };
  }

  /**
   * Concatenate messages based on usage strategy
   */
  private concatenateMessages(
    segment: NormalizedMessage[],
    messagesUse: 'user_only' | 'assistant_only' | 'hybrid'
  ): string {
    const roleFilter: Record<string, Set<string>> = {
      user_only: new Set(['user']),
      assistant_only: new Set(['assistant']),
      hybrid: new Set(['user', 'assistant']),
    };

    const allowedRoles = roleFilter[messagesUse];
    const messageLines: string[] = [];

    for (const msg of segment) {
      if (allowedRoles.has(msg.role)) {
        const sequenceId = msg.sequenceNumber ?? 0;
        const content = msg.content || '';
        const speakerName = msg.speakerName || msg.role;
        const timeStamp = msg.timeStamp || '';
        const weekday = msg.weekday || '';

        let timePrefix = '';
        if (timeStamp && weekday) {
          timePrefix = `[${timeStamp}, ${weekday}] `;
        }

        messageLines.push(`${timePrefix}${Math.floor(sequenceId / 2)}.${speakerName}: ${content}`);
      }
    }

    return messageLines.join('\n');
  }

  /**
   * Extract metadata/facts from message segments
   */
  async metaTextExtract(
    segments: NormalizedMessage[][],
    messagesUse: 'user_only' | 'assistant_only' | 'hybrid' = 'user_only',
    topicIdMapping?: number[]
  ): Promise<ExtractionResult[]> {
    if (!segments || segments.length === 0) {
      return [];
    }

    const results: ExtractionResult[] = [];

    // Process segments (can be parallelized with Promise.all if needed)
    for (let topicIdx = 0; topicIdx < segments.length; topicIdx++) {
      const segment = segments[topicIdx];
      const topicId = topicIdMapping?.[topicIdx] ?? topicIdx + 1;

      try {
        const topicText = this.concatenateMessages(segment, messagesUse);
        const userPrompt = `--- Topic ${topicId} ---\n${topicText}`;

        const metadataMessages = [
          { role: 'system', content: METADATA_GENERATE_PROMPT },
          { role: 'user', content: userPrompt },
        ];

        const { response, usage } = await this.generateResponse(metadataMessages, { type: 'json_object' });

        const facts = cleanResponse(response);

        results.push({
          inputPrompt: metadataMessages,
          outputPrompt: response,
          cleanedResult: facts,
          usage,
        });
      } catch (e) {
        console.error(`Error processing segment ${topicIdx}:`, e);
        results.push({
          inputPrompt: [],
          outputPrompt: '',
          cleanedResult: [],
          usage: null,
        });
      }
    }

    return results;
  }

  /**
   * Call LLM to decide on memory update action
   */
  async callUpdateLlm(
    targetMemory: string,
    candidateMemories: string[]
  ): Promise<UpdateResult> {
    const userPrompt = `Target memory: ${targetMemory}\nCandidate memories:\n${candidateMemories.map((m) => `- ${m}`).join('\n')}`;

    const messages = [
      { role: 'system', content: UPDATE_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    try {
      const { response, usage } = await this.generateResponse(messages, { type: 'json_object' });

      const result = JSON.parse(response);

      if (!result.action) {
        return { action: 'ignore', usage };
      }

      return {
        action: result.action,
        newMemory: result.new_memory,
        usage,
      };
    } catch (e) {
      console.error('Error in callUpdateLlm:', e);
      return { action: 'ignore', usage: null };
    }
  }
}
