import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { LiteMemory } from '../liteMem';
import { LiteMemConfig } from '../types';
import * as fs from 'fs';
import * as path from 'path';

// Status constants
const STATUS_SUCCESS = 'success';
const STATUS_ERROR = 'error';

// Global LiteMemory instance
let liteMemInstance: LiteMemory | null = null;

// Configuration path (default to config.json in current directory)
let configPath = process.env.LITEMEM_CONFIG || './config.json';

/**
 * Load configuration from file
 */
function loadConfig(): LiteMemConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  const configContent = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(configContent) as LiteMemConfig;
}

/**
 * Get or create LiteMemory instance
 */
async function getLiteMemInstance(): Promise<LiteMemory> {
  if (!liteMemInstance) {
    const config = loadConfig();
    liteMemInstance = new LiteMemory(config);
    await liteMemInstance.initialize();
  }
  return liteMemInstance;
}

/**
 * Tool definitions
 */
const TOOLS = [
  {
    name: 'getTimestamp',
    description: 'Get the current timestamp in ISO format',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'addMemory',
    description: 'Add a new memory (user input and assistant reply pair) to LiteMem',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userInput: {
          type: 'string',
          description: "User's input or question",
        },
        assistantReply: {
          type: 'string',
          description: "Assistant's response",
        },
        timestamp: {
          type: 'string',
          description: 'Optional timestamp in format "YYYY/MM/DD (Day) HH:MM"',
        },
        forceExtract: {
          type: 'boolean',
          description: 'Force immediate extraction regardless of buffer',
        },
      },
      required: ['userInput', 'assistantReply'],
    },
  },
  {
    name: 'retrieveMemory',
    description: 'Retrieve relevant memories based on a query',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query to search for relevant memories',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'offlineUpdate',
    description: 'Run offline update to consolidate and merge memories',
    inputSchema: {
      type: 'object' as const,
      properties: {
        topK: {
          type: 'number',
          description: 'Number of nearest neighbors to consider (default: 20)',
        },
        keepTopN: {
          type: 'number',
          description: 'Number of top entries to keep in queue (default: 10)',
        },
        scoreThreshold: {
          type: 'number',
          description: 'Minimum similarity score for updates (default: 0.8)',
        },
      },
      required: [],
    },
  },
  {
    name: 'getStatistics',
    description: 'Get token usage statistics',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

/**
 * Handle tool calls
 */
async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ status: string; message: string; details?: unknown }> {
  try {
    switch (name) {
      case 'getTimestamp': {
        const timestamp = new Date().toISOString();
        return { status: STATUS_SUCCESS, message: timestamp };
      }

      case 'addMemory': {
        const liteMem = await getLiteMemInstance();

        const userInput = args.userInput as string;
        const assistantReply = args.assistantReply as string;
        const timestamp = (args.timestamp as string) || formatTimestamp(new Date());
        const forceExtract = (args.forceExtract as boolean) || false;

        if (!userInput || !assistantReply) {
          return {
            status: STATUS_ERROR,
            message: 'Both userInput and assistantReply are required',
          };
        }

        const messages = [
          { role: 'user' as const, content: userInput, timeStamp: timestamp },
          { role: 'assistant' as const, content: assistantReply, timeStamp: timestamp },
        ];

        const result = await liteMem.addMemory(messages, { forceExtract });

        return {
          status: STATUS_SUCCESS,
          message: `Memory added successfully. Created ${result.memoryEntriesCreated} entries.`,
          details: result,
        };
      }

      case 'retrieveMemory': {
        const liteMem = await getLiteMemInstance();

        const query = args.query as string;
        const limit = (args.limit as number) || 10;

        if (!query) {
          return { status: STATUS_ERROR, message: 'Query parameter is required' };
        }

        const memories = await liteMem.retrieve(query, limit);
        const memoriesList = memories.split('\n').filter((m) => m.trim());

        return {
          status: STATUS_SUCCESS,
          message: `Retrieved ${memoriesList.length} relevant memories`,
          details: memoriesList,
        };
      }

      case 'offlineUpdate': {
        const liteMem = await getLiteMemInstance();

        const topK = (args.topK as number) || 20;
        const keepTopN = (args.keepTopN as number) || 10;
        const scoreThreshold = (args.scoreThreshold as number) || 0.8;

        await liteMem.constructUpdateQueueAllEntries(topK, keepTopN);
        await liteMem.offlineUpdateAllEntries(scoreThreshold);

        return {
          status: STATUS_SUCCESS,
          message: 'Offline update completed successfully',
        };
      }

      case 'getStatistics': {
        const liteMem = await getLiteMemInstance();
        const stats = liteMem.getTokenStatistics();
        const count = await liteMem.getMemoryCount();

        return {
          status: STATUS_SUCCESS,
          message: `LiteMem statistics retrieved`,
          details: { ...stats, memoryCount: count },
        };
      }

      default:
        return { status: STATUS_ERROR, message: `Unknown tool: ${name}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: STATUS_ERROR, message: `Error: ${message}` };
  }
}

/**
 * Format date to expected timestamp format
 */
function formatTimestamp(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const weekday = days[date.getDay()];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}/${month}/${day} (${weekday}) ${hours}:${minutes}`;
}

/**
 * Main server setup
 */
async function main() {
  // Check for config path argument
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
    }
  }

  console.error('LiteMem MCP Server starting...');
  console.error(`Using config: ${configPath}`);

  const server = new Server(
    {
      name: 'litemem',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await handleToolCall(name, args || {});

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('LiteMem MCP Server running');
}

// Run server
main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
