/**
 * Represents a candidate entry for memory update operations
 */
export interface UpdateCandidate {
  id: string;
  score: number;
}

/**
 * Core memory entry structure
 * Stores extracted facts with metadata for retrieval and updates
 */
export interface MemoryEntry {
  id: string;
  timeStamp: string;           // ISO format datetime
  floatTimeStamp: number;      // Unix timestamp for comparisons
  weekday: string;             // Day of week (e.g., "Mon", "Tue")
  category: string;            // Semantic category
  subcategory: string;         // Fine-grained category
  memoryClass: string;         // Classification label
  memory: string;              // Processed/extracted fact
  originalMemory: string;      // Original text before processing
  compressedMemory: string;    // Token-reduced version (future use)
  topicId: number | null;      // Segment relationship ID
  topicSummary: string;        // Segment-level summary
  speakerId: string;           // Conversation participant ID
  speakerName: string;         // Display name of speaker
  hitTime: number;             // Retrieval count
  updateQueue: UpdateCandidate[];
}

/**
 * Creates a new MemoryEntry with default values
 */
export function createMemoryEntry(partial: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: crypto.randomUUID(),
    timeStamp: new Date().toISOString(),
    floatTimeStamp: Date.now() / 1000,
    weekday: '',
    category: '',
    subcategory: '',
    memoryClass: '',
    memory: '',
    originalMemory: '',
    compressedMemory: '',
    topicId: null,
    topicSummary: '',
    speakerId: '',
    speakerName: '',
    hitTime: 0,
    updateQueue: [],
    ...partial,
  };
}
