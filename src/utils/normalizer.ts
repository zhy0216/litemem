import { Message, NormalizedMessage } from '../types/messages';

/**
 * Regex pattern for parsing session timestamps
 * Matches formats like "2023/05/20 (Sat) 00:44" or "2023-05-20 (Saturday) 14:30:00"
 */
const SESSION_RE = /(?<date>\d{4}[/-]\d{1,2}[/-]\d{1,2})\s*\((?<weekday>[^)]+)\)\s*(?<time>\d{1,2}:\d{2}(?::\d{2})?)/;

/**
 * Parse a session timestamp into a Date and weekday
 */
function parseSessionTimestamp(rawTs: string): { date: Date; weekday: string } {
  const match = rawTs.match(SESSION_RE);

  if (match && match.groups) {
    const dateStr = match.groups.date.replace(/-/g, '/');
    const timeStr = match.groups.time;
    const weekday = match.groups.weekday;

    // Parse as local time
    const dateTimeStr = `${dateStr} ${timeStr}`;
    const date = new Date(dateTimeStr.replace(/\//g, '-'));

    if (!isNaN(date.getTime())) {
      return { date, weekday };
    }
  }

  // Try ISO format fallback
  try {
    const date = new Date(rawTs);
    if (!isNaN(date.getTime())) {
      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return { date, weekday: weekdays[date.getDay()] };
    }
  } catch {
    // Fall through to error
  }

  throw new Error(`Failed to parse session time format: '${rawTs}'. Expected format like '2023/05/20 (Sat) 00:44'`);
}

/**
 * Normalizes messages with timestamps and metadata
 */
export class MessageNormalizer {
  private lastTimestampMap: Map<string, Date> = new Map();
  private offsetMs: number;

  constructor(offsetMs = 500) {
    this.offsetMs = offsetMs;
  }

  /**
   * Normalize a list of messages
   */
  normalizeMessages(messages: Message | Message[]): NormalizedMessage[] {
    const messageList = Array.isArray(messages) ? messages : [messages];

    const enrichedList: NormalizedMessage[] = [];

    for (const msg of messageList) {
      const rawTs = msg.timeStamp;
      if (!rawTs) {
        throw new Error("Each message should contain a 'timeStamp' field");
      }

      const { date: baseDate, weekday } = parseSessionTimestamp(rawTs);

      // Maintain incrementing time based on session key
      const lastDate = this.lastTimestampMap.get(rawTs);
      let newDate: Date;

      if (!lastDate) {
        newDate = baseDate;
      } else {
        newDate = new Date(lastDate.getTime() + this.offsetMs);
      }

      this.lastTimestampMap.set(rawTs, newDate);

      const enriched: NormalizedMessage = {
        ...msg,
        sessionTime: rawTs,
        timeStamp: newDate.toISOString(),
        weekday,
      };

      enrichedList.push(enriched);
    }

    return enrichedList;
  }

  /**
   * Reset the timestamp tracking
   */
  reset(): void {
    this.lastTimestampMap.clear();
  }
}

/**
 * Assign sequence numbers to messages
 */
export function assignSequenceNumbers(
  messages: NormalizedMessage[]
): NormalizedMessage[] {
  return messages.map((msg, index) => ({
    ...msg,
    sequenceNumber: index,
  }));
}
