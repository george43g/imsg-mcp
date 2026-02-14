#!/usr/bin/env node
/**
 * iMessage MCP Server
 * Enables AI agents to send and receive iMessages on macOS
 */

import { execSync } from 'child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { IMessageDB } from './imessage-db.js';
import { sendMessageAlt, checkMessagesAvailable } from './applescript.js';
import { appendLog, getLogs, getLastSendError } from './logger.js';
import type { Message } from './types.js';

// Tool input schemas
const GetMessagesSchema = z.object({
  limit: z.number().min(1).max(100).default(20).describe('Number of messages to retrieve'),
  chatIdentifier: z.string().optional().describe('Phone number, email, or chat ID to filter by'),
});

const GetUnreadMessagesSchema = z.object({});

const SendMessageSchema = z.object({
  recipient: z.string().describe('Phone number or email address to send to'),
  message: z.string().describe('Message text to send'),
});

const WaitForReplySchema = z.object({
  chatIdentifier: z.string().describe('Phone number, email, or chat ID to monitor'),
  timeoutSeconds: z.number().min(10).max(3600).default(300).describe('Timeout in seconds (default 5 minutes)'),
  pollIntervalSeconds: z.number().min(5).max(60).default(10).describe('How often to check for replies'),
  afterMessageId: z.number().optional().describe('Only return messages after this ID'),
});

const ListConversationsSchema = z.object({
  limit: z.number().min(1).max(50).default(20).describe('Number of conversations to list'),
});

const SearchMessagesSchema = z.object({
  query: z.string().describe('Search query'),
  limit: z.number().min(1).max(50).default(20).describe('Number of results'),
});

const GetLogsSchema = z.object({
  tail: z.number().min(1).max(500).optional().describe('Return only last N lines (default: all)'),
});

const RunBuildSchema = z.object({});
const RequestRestartSchema = z.object({});

// Tool definitions
const TOOLS = [
  {
    name: 'get_messages',
    description: 'Get recent iMessages. Can optionally filter by a specific conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of messages to retrieve (1-100)', default: 20 },
        chatIdentifier: { type: 'string', description: 'Phone number, email, or chat ID to filter by' },
      },
    },
  },
  {
    name: 'get_unread_messages',
    description: 'Get all unread iMessages across all conversations.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'send_message',
    description: 'Send an iMessage or SMS to a recipient. Requires the recipient\'s phone number or email address.',
    inputSchema: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'Phone number (e.g., +1234567890) or email address' },
        message: { type: 'string', description: 'Message text to send' },
      },
      required: ['recipient', 'message'],
    },
  },
  {
    name: 'wait_for_reply',
    description: 'Wait for a reply in a specific conversation. Polls the database until a new message arrives or timeout is reached. Useful for AI agents that need to wait for human responses.',
    inputSchema: {
      type: 'object',
      properties: {
        chatIdentifier: { type: 'string', description: 'Phone number, email, or chat ID to monitor' },
        timeoutSeconds: { type: 'number', description: 'Timeout in seconds (10-3600, default 300)', default: 300 },
        pollIntervalSeconds: { type: 'number', description: 'How often to check for replies (5-60 seconds)', default: 10 },
        afterMessageId: { type: 'number', description: 'Only return messages after this ID' },
      },
      required: ['chatIdentifier'],
    },
  },
  {
    name: 'list_conversations',
    description: 'List recent conversations with metadata like last message date and participant info.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of conversations to list (1-50)', default: 20 },
      },
    },
  },
  {
    name: 'search_messages',
    description: 'Search for messages containing specific text across all conversations.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Number of results (1-50)', default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_logs',
    description: 'Return in-memory debug log lines from this MCP server (errors and send failures are appended). Use to inspect why send_message failed.',
    inputSchema: {
      type: 'object',
      properties: {
        tail: { type: 'number', description: 'Return only last N lines (default: all)' },
      },
    },
  },
  {
    name: 'get_last_send_error',
    description: 'Return the last send_message/send failure details (stderr, stdout, code from osascript). Use to debug why texting failed.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_build',
    description: 'Run `pnpm build` in the project directory and return stdout/stderr. Restart the MCP server after building to load new code.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'request_restart',
    description: 'Exit the MCP server process so the client can restart it and load new code. Call after run_build to apply changes.',
    inputSchema: { type: 'object', properties: {} },
  },
];

/**
 * Format a message for output
 */
function formatMessage(msg: Message): string {
  const direction = msg.isFromMe ? '→' : '←';
  const dateStr = msg.date.toLocaleString();
  const readStatus = msg.isRead ? '' : ' [UNREAD]';
  return `[${dateStr}] ${direction} ${msg.handle}: ${msg.text || '(no text)'}${readStatus}`;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main MCP server class
 */
class IMessageMCPServer {
  private server: Server;
  private db: IMessageDB;

  constructor() {
    this.server = new Server(
      {
        name: 'imsg-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.db = new IMessageDB();
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS,
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_messages':
            return await this.handleGetMessages(args);
          case 'get_unread_messages':
            return await this.handleGetUnreadMessages();
          case 'send_message':
            return await this.handleSendMessage(args);
          case 'wait_for_reply':
            return await this.handleWaitForReply(args);
          case 'list_conversations':
            return await this.handleListConversations(args);
          case 'search_messages':
            return await this.handleSearchMessages(args);
          case 'get_logs':
            return await this.handleGetLogs(args);
          case 'get_last_send_error':
            return await this.handleGetLastSendError();
          case 'run_build':
            return await this.handleRunBuild();
          case 'request_restart':
            return await this.handleRequestRestart();
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        appendLog('error', 'Tool error', { tool: name, error: error.message || String(error) });
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message || String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleGetLogs(args: unknown) {
    const { tail } = GetLogsSchema.parse(args ?? {});
    const lines = getLogs(tail);
    const text = lines.length === 0 ? 'No log lines yet.' : lines.join('\n');
    return { content: [{ type: 'text', text }] };
  }

  private async handleGetLastSendError() {
    const err = getLastSendError();
    if (!err) {
      return { content: [{ type: 'text', text: 'No send failure recorded. Last send either succeeded or occurred before this server run.' }] };
    }
    const text = [
      'Last send_message failure:',
      `  message: ${err.message}`,
      `  timestamp: ${err.timestamp}`,
      err.stderr != null ? `  stderr: ${err.stderr}` : '',
      err.stdout != null ? `  stdout: ${err.stdout}` : '',
      err.code != null ? `  code: ${err.code}` : '',
    ].filter(Boolean).join('\n');
    return { content: [{ type: 'text', text }] };
  }

  private async handleRunBuild(): Promise<any> {
    try {
      const out = execSync('pnpm build', {
        encoding: 'utf-8',
        maxBuffer: 2 * 1024 * 1024,
        cwd: process.cwd(),
      });
      return { content: [{ type: 'text', text: `Build succeeded.\n\nstdout:\n${out}` }] };
    } catch (error: any) {
      const stderr = error.stderr?.toString?.() ?? error.message ?? '';
      const stdout = error.stdout?.toString?.() ?? '';
      appendLog('error', 'run_build failed', { stderr, stdout });
      return {
        content: [{ type: 'text', text: `Build failed.\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}` }],
        isError: true,
      };
    }
  }

  private async handleRequestRestart(): Promise<any> {
    const msg = 'Restart requested. Please restart the MCP server in your client (e.g. Cursor) to load new code.';
    setImmediate(() => process.exit(0));
    return { content: [{ type: 'text', text: msg }] };
  }

  private async handleGetMessages(args: unknown) {
    const { limit, chatIdentifier } = GetMessagesSchema.parse(args);
    
    let messages: Message[];
    if (chatIdentifier) {
      messages = await this.db.getMessagesForChat(chatIdentifier, limit);
    } else {
      messages = await this.db.getRecentMessages(limit);
    }

    if (messages.length === 0) {
      return {
        content: [{ type: 'text', text: 'No messages found.' }],
      };
    }

    const formatted = messages.map(formatMessage).join('\n');
    return {
      content: [
        {
          type: 'text',
          text: `Found ${messages.length} message(s):\n\n${formatted}`,
        },
      ],
    };
  }

  private async handleGetUnreadMessages() {
    const messages = await this.db.getUnreadMessages();

    if (messages.length === 0) {
      return {
        content: [{ type: 'text', text: 'No unread messages.' }],
      };
    }

    const formatted = messages.map(formatMessage).join('\n');
    return {
      content: [
        {
          type: 'text',
          text: `Found ${messages.length} unread message(s):\n\n${formatted}`,
        },
      ],
    };
  }

  private async handleSendMessage(args: unknown) {
    const { recipient, message } = SendMessageSchema.parse(args);

    // Check if Messages.app is accessible
    const available = await checkMessagesAvailable();
    if (!available) {
      return {
        content: [
          {
            type: 'text',
            text: 'Messages.app is not running or accessible. Please ensure Messages is open and you have granted necessary permissions.',
          },
        ],
        isError: true,
      };
    }

    // Try to send the message
    const result = await sendMessageAlt(recipient, message);

    if (result.success) {
      // Get the last message to return the ID for wait_for_reply
      const chat = await this.db.findChatByHandle(recipient);
      let lastMessageId: number | undefined;
      
      if (chat) {
        const lastMsg = await this.db.getLastMessage(chat.chatIdentifier);
        lastMessageId = lastMsg?.id;
      }

      return {
        content: [
          {
            type: 'text',
            text: `Message sent successfully to ${recipient} at ${result.timestamp?.toLocaleString()}${lastMessageId ? `\nLast message ID: ${lastMessageId} (use this with wait_for_reply)` : ''}`,
          },
        ],
      };
    } else {
      appendLog('error', 'send_message failed', { recipient, error: result.error });
      return {
        content: [
          {
            type: 'text',
            text: `Failed to send message: ${result.error}. Use get_last_send_error to see osascript stderr/stdout.`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleWaitForReply(args: unknown): Promise<any> {
    const { chatIdentifier, timeoutSeconds, pollIntervalSeconds, afterMessageId } = WaitForReplySchema.parse(args);

    const timeoutMs = timeoutSeconds * 1000;
    const pollIntervalMs = pollIntervalSeconds * 1000;
    const startTime = Date.now();

    // Find the chat
    const chat = await this.db.findChatByHandle(chatIdentifier);
    if (!chat) {
      return {
        content: [
          {
            type: 'text',
            text: `Could not find conversation for: ${chatIdentifier}`,
          },
        ],
        isError: true,
      };
    }

    // Get the current last message ID if not provided
    let lastKnownId = afterMessageId;
    if (!lastKnownId) {
      const lastMsg = await this.db.getLastMessage(chat.chatIdentifier);
      lastKnownId = lastMsg?.id || 0;
    }

    // Poll for new messages
    while (Date.now() - startTime < timeoutMs) {
      const newMessages = await this.db.getMessagesAfter(chat.chatIdentifier, lastKnownId);
      
      if (newMessages.length > 0) {
        const formatted = newMessages.map(formatMessage).join('\n');
        return {
          content: [
            {
              type: 'text',
              text: `Received ${newMessages.length} new message(s):\n\n${formatted}`,
            },
          ],
        };
      }

      await sleep(pollIntervalMs);
    }

    // Timeout reached
    return {
      content: [
        {
          type: 'text',
          text: `Timeout reached (${timeoutSeconds}s) - no new messages received in conversation with ${chatIdentifier}`,
        },
      ],
    };
  }

  private async handleListConversations(args: unknown) {
    const { limit } = ListConversationsSchema.parse(args);
    
    const conversations = await this.db.listConversations();
    const limited = conversations.slice(0, limit);

    if (limited.length === 0) {
      return {
        content: [{ type: 'text', text: 'No conversations found.' }],
      };
    }

    const formatted = limited.map(conv => {
      const name = conv.displayName || conv.chatIdentifier;
      const participants = conv.participants.length > 0 ? ` (${conv.participants.join(', ')})` : '';
      const lastDate = conv.lastMessageDate ? ` - Last: ${conv.lastMessageDate.toLocaleDateString()}` : '';
      const unread = conv.unreadCount > 0 ? ` [${conv.unreadCount} unread]` : '';
      return `• ${name}${participants}${lastDate}${unread}`;
    }).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${limited.length} conversation(s):\n\n${formatted}`,
        },
      ],
    };
  }

  private async handleSearchMessages(args: unknown) {
    const { query, limit } = SearchMessagesSchema.parse(args);
    
    const messages = await this.db.searchMessages(query, limit);

    if (messages.length === 0) {
      return {
        content: [{ type: 'text', text: `No messages found matching "${query}".` }],
      };
    }

    const formatted = messages.map(formatMessage).join('\n');
    return {
      content: [
        {
          type: 'text',
          text: `Found ${messages.length} message(s) matching "${query}":\n\n${formatted}`,
        },
      ],
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    appendLog('info', 'iMessage MCP Server running on stdio');
    console.error('iMessage MCP Server running on stdio');
  }
}

// Run the server
const server = new IMessageMCPServer();
server.run().catch(console.error);
