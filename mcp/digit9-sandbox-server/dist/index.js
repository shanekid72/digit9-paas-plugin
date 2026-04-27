/**
 * Entry point for the Digit9 sandbox MCP server.
 *
 * Registers eight tools that wrap the PaaS sandbox endpoints. Tools share a
 * single D9Client (see ./client.ts) which caches the OAuth2 token and injects
 * the four required context headers.
 *
 * The server speaks MCP over stdio, which is how Claude Code spawns and
 * communicates with it (see plugin.json's mcpServers block).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { d9_get_token } from './tools/d9_get_token.js';
import { d9_get_corridors } from './tools/d9_get_corridors.js';
import { d9_get_banks } from './tools/d9_get_banks.js';
import { d9_quote } from './tools/d9_quote.js';
import { d9_create_txn } from './tools/d9_create_txn.js';
import { d9_confirm_txn } from './tools/d9_confirm_txn.js';
import { d9_enquire_txn } from './tools/d9_enquire_txn.js';
import { d9_simulate_webhook } from './tools/d9_simulate_webhook.js';
const tools = [
    d9_get_token,
    d9_get_corridors,
    d9_get_banks,
    d9_quote,
    d9_create_txn,
    d9_confirm_txn,
    d9_enquire_txn,
    d9_simulate_webhook,
];
const server = new Server({ name: 'digit9-sandbox', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
    })),
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) {
        return {
            isError: true,
            content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
        };
    }
    try {
        const result = await tool.execute((req.params.arguments ?? {}));
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    catch (e) {
        return {
            isError: true,
            content: [{ type: 'text', text: e?.message ?? String(e) }],
        };
    }
});
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=index.js.map