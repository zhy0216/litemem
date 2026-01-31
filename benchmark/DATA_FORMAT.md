# LoCoMo Data Format Reference

This document describes the LoCoMo dataset structure and how to convert it for LiteMemory.

## LoCoMo JSON Structure

### Top Level

`locomo10.json` is an array of 10 conversation objects:

```json
[
  {
    "sample_id": 0,
    "conversation": { ... },
    "qa": [ ... ],
    "observation": [ ... ],
    "session_summary": [ ... ],
    "event_summary": { ... }
  },
  ...
]
```

### Conversation Object

```json
{
  "conversation": {
    "speaker_a": "Caroline",
    "speaker_b": "Melanie",
    "session_1_date_time": "1:56 pm on 8 May, 2023",
    "session_1": [
      {
        "speaker": "Caroline",
        "dia_id": "D1:1",
        "text": "Hey Melanie! How's it going?"
      },
      {
        "speaker": "Melanie",
        "dia_id": "D1:2",
        "text": "Hi Caroline! I'm doing well..."
      }
    ],
    "session_2_date_time": "10:23 am on 15 May, 2023",
    "session_2": [ ... ],
    ...
  }
}
```

**Dialog Entry Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `speaker` | string | Speaker name |
| `dia_id` | string | Format: `D{session}:{turn}` |
| `text` | string | Dialog content |
| `img_url` | string? | Image URL (if multimodal) |
| `blip_caption` | string? | Generated image caption |
| `query` | string? | Image search query used |

### QA Object

```json
{
  "qa": [
    {
      "question": "When did Caroline go to the LGBTQ support group?",
      "answer": "7 May 2023",
      "evidence": ["D1:3"],
      "category": 2
    },
    {
      "question": "What color was the car they saw?",
      "answer": "red",
      "evidence": ["D3:15", "D3:16"],
      "category": 1,
      "adversarial_answer": "blue"  // Only for category 5
    }
  ]
}
```

**QA Categories:**

| Category | Name | Description |
|----------|------|-------------|
| 1 | Single-hop explicit | Answer directly stated in one turn |
| 2 | Single-hop implicit | Requires inference within one session |
| 3 | Multi-hop | Requires combining info across sessions |
| 4 | Temporal | Requires temporal reasoning |
| 5 | Adversarial | Contains misleading information |

### Observation Object (Generated)

Session-level observations for RAG evaluation:

```json
{
  "observation": [
    {
      "session_id": 1,
      "observations": [
        "Caroline attended an LGBTQ support group on May 7th",
        "Melanie is supportive of Caroline's journey"
      ]
    }
  ]
}
```

### Event Summary (Annotated Ground Truth)

```json
{
  "event_summary": {
    "Caroline": [
      "Attended LGBTQ support group",
      "Started new job at tech company"
    ],
    "Melanie": [
      "Celebrated birthday",
      "Got promoted at work"
    ]
  }
}
```

## Converting to LiteMemory Format

### Message Format

LiteMemory expects:

```typescript
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timeStamp?: string;  // Format: "2023/05/08 (Mon) 13:56"
}
```

### Conversion Logic

```typescript
function convertLocomoToMessages(conversation: LocomoConversation): Message[] {
  const messages: Message[] = [];
  const speakerA = conversation.speaker_a;

  // Get all sessions
  const sessionKeys = Object.keys(conversation)
    .filter(k => k.startsWith('session_') && !k.includes('date_time'))
    .sort((a, b) => {
      const numA = parseInt(a.split('_')[1]);
      const numB = parseInt(b.split('_')[1]);
      return numA - numB;
    });

  for (const sessionKey of sessionKeys) {
    const sessionNum = sessionKey.split('_')[1];
    const dateTimeKey = `session_${sessionNum}_date_time`;
    const dateTime = conversation[dateTimeKey];
    const timestamp = parseLocomoDateTime(dateTime);

    const dialogs = conversation[sessionKey];
    for (const dialog of dialogs) {
      messages.push({
        role: dialog.speaker === speakerA ? 'user' : 'assistant',
        content: dialog.text,
        timeStamp: timestamp
      });
    }
  }

  return messages;
}
```

### DateTime Parsing

LoCoMo uses format: `"1:56 pm on 8 May, 2023"`

Convert to LiteMemory format: `"2023/05/08 (Mon) 13:56"`

```typescript
function parseLocomoDateTime(dateTime: string): string {
  // Parse "1:56 pm on 8 May, 2023"
  const match = dateTime.match(
    /(\d{1,2}):(\d{2})\s*(am|pm)\s*on\s*(\d{1,2})\s*(\w+),?\s*(\d{4})/i
  );

  if (!match) return dateTime;

  let [_, hour, minute, ampm, day, month, year] = match;
  let hourNum = parseInt(hour);
  if (ampm.toLowerCase() === 'pm' && hourNum !== 12) hourNum += 12;
  if (ampm.toLowerCase() === 'am' && hourNum === 12) hourNum = 0;

  const monthMap: Record<string, string> = {
    'January': '01', 'February': '02', 'March': '03', 'April': '04',
    'May': '05', 'June': '06', 'July': '07', 'August': '08',
    'September': '09', 'October': '10', 'November': '11', 'December': '12'
  };

  const monthNum = monthMap[month] || '01';
  const dayPadded = day.padStart(2, '0');
  const hourPadded = String(hourNum).padStart(2, '0');

  // Get weekday
  const date = new Date(`${year}-${monthNum}-${dayPadded}`);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = weekdays[date.getDay()];

  return `${year}/${monthNum}/${dayPadded} (${weekday}) ${hourPadded}:${minute}`;
}
```

## Evidence Dialog ID Mapping

QA evidence references dialog IDs like `"D1:3"` (session 1, turn 3).

To track evidence coverage, map extracted memories back to source dialog IDs:

```typescript
interface MemoryWithEvidence extends MemoryEntry {
  sourceDialogIds: string[];  // ["D1:3", "D1:4"]
}

function checkEvidenceCoverage(
  retrievedMemories: MemoryWithEvidence[],
  evidenceIds: string[]
): number {
  const covered = new Set<string>();

  for (const memory of retrievedMemories) {
    for (const id of memory.sourceDialogIds) {
      if (evidenceIds.includes(id)) {
        covered.add(id);
      }
    }
  }

  return covered.size / evidenceIds.length;
}
```

## Data Statistics

LoCoMo10 contains:

| Metric | Value |
|--------|-------|
| Conversations | 10 |
| Total sessions | ~50-60 |
| Total dialog turns | ~3,000-4,000 |
| Total QA pairs | ~847 |
| QA per conversation | ~80-100 |
| Avg turns per session | ~50-80 |

### QA Category Distribution

| Category | Approximate % |
|----------|--------------|
| 1 (Single explicit) | 25% |
| 2 (Single implicit) | 25% |
| 3 (Multi-hop) | 20% |
| 4 (Temporal) | 15% |
| 5 (Adversarial) | 15% |
