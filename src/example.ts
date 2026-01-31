/**
 * Example usage of LiteMem
 *
 * Before running, copy config.example.json to config.json and fill in your API keys:
 *   cp config.example.json config.json
 *
 * Then run:
 *   OPENROUTER_API_KEY=your_key bun run example.ts
 */

import { LiteMemory, createDefaultConfig } from './index';

async function main() {
  // Create config (you can also load from JSON file)
  const config = createDefaultConfig({
    llm: {
      apiKey: process.env.OPENROUTER_API_KEY || '',
      model: 'openai/gpt-4o-mini',
    },
    embedder: {
      apiKey: process.env.OPENROUTER_API_KEY || '',
      model: 'openai/text-embedding-3-small',
      dimensions: 1536,
    },
    turso: {
      url: 'file:./example.db',
    },
    logging: {
      level: 'info',
    },
  });

  // Create LiteMem instance
  const liteMem = new LiteMemory(config);

  // Initialize database
  await liteMem.initialize();

  console.log('LiteMem initialized!');

  // Add some memories
  const messages = [
    {
      role: 'user' as const,
      content: 'My name is Alice and I work as a software engineer.',
      timeStamp: '2024/01/15 (Mon) 10:00',
    },
    {
      role: 'assistant' as const,
      content: 'Nice to meet you, Alice! Software engineering is a great field.',
      timeStamp: '2024/01/15 (Mon) 10:00',
    },
    {
      role: 'user' as const,
      content: 'I love hiking on weekends and my favorite food is sushi.',
      timeStamp: '2024/01/15 (Mon) 10:01',
    },
    {
      role: 'assistant' as const,
      content: 'Those are wonderful hobbies! Do you have a favorite hiking trail?',
      timeStamp: '2024/01/15 (Mon) 10:01',
    },
  ];

  console.log('\nAdding memories...');
  const result = await liteMem.addMemory(messages, { forceExtract: true });
  console.log(`Created ${result.memoryEntriesCreated} memory entries`);

  // Retrieve memories
  console.log('\nRetrieving memories about hobbies...');
  const memories = await liteMem.retrieve('What are the user hobbies?', 5);
  console.log('Retrieved memories:');
  console.log(memories);

  // Get statistics
  const stats = liteMem.getTokenStatistics();
  console.log('\nToken statistics:', JSON.stringify(stats, null, 2));

  // Close database
  await liteMem.close();
  console.log('\nDone!');
}

main().catch(console.error);
