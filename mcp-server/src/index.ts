import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { config } from './config.js';
import { log } from './log.js';
import { createClient } from './http/client.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';

const server = new McpServer({ name: 'devdigest', version: '0.1.0' });
const client = createClient(config.apiUrl);

registerListAgents(server, client);
registerRunAgentOnPr(server, client);
registerGetFindings(server, client);
registerGetConventions(server, client);
registerGetBlastRadius(server, client);

const transport = new StdioServerTransport();

log.info('DevDigest MCP server starting, API:', config.apiUrl);

await server.connect(transport);
