import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Client } from '../http/client.js';
import { ApiError } from '../http/client.js';
import { toolOk, toolError } from '../format.js';
import { config } from '../config.js';

export function registerListAgents(server: McpServer, client: Client): void {
  server.tool(
    'devdigest_list_agents',
    "List the reviewer agents configured in DevDigest (id, name, model, enabled). Call this first to get a valid 'agent' id for devdigest_run_agent_on_pr — do not guess or invent agent ids.",
    {},
    async () => {
      try {
        const agents = await client.listAgents();
        return toolOk({
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            enabled: a.enabled,
            model: a.model,
          })),
        });
      } catch (e) {
        if (e instanceof ApiError) {
          return toolError(
            `DevDigest API unreachable at ${config.apiUrl} — start it with ./scripts/dev.sh.`,
          );
        }
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
