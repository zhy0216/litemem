/**
 * LoCoMo → LiteMemory data converter
 */

import { readFileSync } from 'fs';
import type { Message } from '../src/types';

// LoCoMo types
export interface LocomoDialog {
  speaker: string;
  dia_id: string;
  text: string;
  img_url?: string;
  blip_caption?: string;
  query?: string;
}

export interface LocomoConversation {
  speaker_a: string;
  speaker_b: string;
  [key: string]: string | LocomoDialog[] | undefined;
}

export interface LocomoQA {
  question: string;
  answer: string | number;
  evidence: string[];
  category: number;
  adversarial_answer?: string;
}

export interface LocomoSample {
  sample_id: number;
  conversation: LocomoConversation;
  qa: LocomoQA[];
  observation?: Array<{ session_id: number; observations: string[] }>;
  session_summary?: Array<{ session_id: number; summary: string }>;
  event_summary?: Record<string, string[]>;
}

// Extended message with source tracking
export interface MessageWithSource extends Message {
  dialogId: string;
  speaker: string;
  sessionNum: number;
}

/**
 * Load LoCoMo dataset
 */
export function loadLocomoData(path: string): LocomoSample[] {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as LocomoSample[];
}

/**
 * Parse LoCoMo datetime format to LiteMemory format
 * Input: "1:56 pm on 8 May, 2023"
 * Output: "2023/05/08 (Mon) 13:56"
 */
export function parseLocomoDateTime(dateTime: string): string {
  const match = dateTime.match(
    /(\d{1,2}):(\d{2})\s*(am|pm)\s*on\s*(\d{1,2})\s*(\w+),?\s*(\d{4})/i
  );

  if (!match) {
    console.warn(`Could not parse datetime: ${dateTime}`);
    return dateTime;
  }

  const [, hour, minute, ampm, day, month, year] = match;
  let hourNum = parseInt(hour);
  if (ampm.toLowerCase() === 'pm' && hourNum !== 12) hourNum += 12;
  if (ampm.toLowerCase() === 'am' && hourNum === 12) hourNum = 0;

  const monthMap: Record<string, string> = {
    January: '01', February: '02', March: '03', April: '04',
    May: '05', June: '06', July: '07', August: '08',
    September: '09', October: '10', November: '11', December: '12',
  };

  const monthNum = monthMap[month] || '01';
  const dayPadded = day.padStart(2, '0');
  const hourPadded = String(hourNum).padStart(2, '0');

  const date = new Date(`${year}-${monthNum}-${dayPadded}`);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = weekdays[date.getDay()];

  return `${year}/${monthNum}/${dayPadded} (${weekday}) ${hourPadded}:${minute}`;
}

/**
 * Convert a LoCoMo conversation to LiteMemory messages
 */
export function convertConversationToMessages(
  conversation: LocomoConversation
): MessageWithSource[] {
  const messages: MessageWithSource[] = [];
  const speakerA = conversation.speaker_a;

  // Get session keys and sort
  const sessionKeys = Object.keys(conversation)
    .filter((k) => k.startsWith('session_') && !k.includes('date_time'))
    .sort((a, b) => {
      const numA = parseInt(a.split('_')[1]);
      const numB = parseInt(b.split('_')[1]);
      return numA - numB;
    });

  for (const sessionKey of sessionKeys) {
    const sessionNum = parseInt(sessionKey.split('_')[1]);
    const dateTimeKey = `session_${sessionNum}_date_time`;
    const dateTimeRaw = conversation[dateTimeKey] as string | undefined;
    const timestamp = dateTimeRaw ? parseLocomoDateTime(dateTimeRaw) : '';

    const dialogs = conversation[sessionKey] as LocomoDialog[];
    if (!Array.isArray(dialogs)) continue;

    for (const dialog of dialogs) {
      // Map speaker_a to 'user', speaker_b to 'assistant'
      const role = dialog.speaker === speakerA ? 'user' : 'assistant';

      // Include image caption in content if present
      let content = dialog.text;
      if (dialog.blip_caption) {
        content += `\n[Image: ${dialog.blip_caption}]`;
      }

      messages.push({
        role,
        content,
        timeStamp: timestamp,
        dialogId: dialog.dia_id,
        speaker: dialog.speaker,
        sessionNum,
      });
    }
  }

  return messages;
}

/**
 * Convert to standard LiteMemory Message format (without source tracking)
 */
export function toStandardMessages(messages: MessageWithSource[]): Message[] {
  return messages.map(({ role, content, timeStamp }) => ({
    role,
    content,
    timeStamp,
  }));
}

/**
 * Get QA pairs for a conversation
 */
export function getQAForConversation(sample: LocomoSample): LocomoQA[] {
  return sample.qa;
}

/**
 * Filter QA by category
 */
export function filterQAByCategory(
  qa: LocomoQA[],
  categories: number[]
): LocomoQA[] {
  return qa.filter((q) => categories.includes(q.category));
}

/**
 * Get statistics about the dataset
 */
export function getDatasetStats(data: LocomoSample[]): {
  conversations: number;
  totalSessions: number;
  totalDialogs: number;
  totalQA: number;
  qaByCategoryCount: Record<number, number>;
} {
  let totalSessions = 0;
  let totalDialogs = 0;
  let totalQA = 0;
  const qaByCategoryCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (const sample of data) {
    const conv = sample.conversation;
    const sessionKeys = Object.keys(conv).filter(
      (k) => k.startsWith('session_') && !k.includes('date_time')
    );
    totalSessions += sessionKeys.length;

    for (const key of sessionKeys) {
      const dialogs = conv[key] as LocomoDialog[];
      if (Array.isArray(dialogs)) {
        totalDialogs += dialogs.length;
      }
    }

    totalQA += sample.qa.length;
    for (const qa of sample.qa) {
      qaByCategoryCount[qa.category] = (qaByCategoryCount[qa.category] || 0) + 1;
    }
  }

  return {
    conversations: data.length,
    totalSessions,
    totalDialogs,
    totalQA,
    qaByCategoryCount,
  };
}

// CLI usage
if (import.meta.main) {
  const dataPath = process.argv[2] || 'benchmark/locomo/data/locomo10.json';

  try {
    const data = loadLocomoData(dataPath);
    const stats = getDatasetStats(data);

    console.log('LoCoMo Dataset Statistics:');
    console.log(`  Conversations: ${stats.conversations}`);
    console.log(`  Total sessions: ${stats.totalSessions}`);
    console.log(`  Total dialogs: ${stats.totalDialogs}`);
    console.log(`  Total QA pairs: ${stats.totalQA}`);
    console.log('  QA by category:');
    for (const [cat, count] of Object.entries(stats.qaByCategoryCount)) {
      console.log(`    Category ${cat}: ${count}`);
    }

    // Show sample conversion
    const sample = data[0];
    const messages = convertConversationToMessages(sample.conversation);
    console.log(`\nFirst conversation has ${messages.length} messages`);
    console.log('First 3 messages:');
    for (const msg of messages.slice(0, 3)) {
      console.log(`  [${msg.dialogId}] ${msg.role}: ${msg.content.slice(0, 50)}...`);
    }
  } catch (err) {
    console.error('Error loading LoCoMo data:', err);
    console.log('\nUsage: bun run benchmark/convert.ts [path-to-locomo10.json]');
    console.log('Default path: benchmark/locomo/data/locomo10.json');
  }
}
