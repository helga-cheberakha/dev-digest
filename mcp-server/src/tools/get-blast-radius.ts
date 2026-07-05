import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Client } from '../http/client.js';
import { ApiError } from '../http/client.js';
import { toolOk, toolError } from '../format.js';
import { resolvePullId } from '../core/resolve.js';
import { config } from '../config.js';

export function registerGetBlastRadius(server: McpServer, client: Client): void {
  server.tool(
    'devdigest_get_blast_radius',
    'Get the blast radius of a pull request: which symbols changed, who calls them, and which HTTP endpoints are reachable through the import graph. Returns changed_symbols, downstream callers, and endpoints_affected.',
    {
      repo: z.string().min(1).describe("Repository as 'owner/name' (e.g. 'octocat/hello')."),
      pr:   z.number().int().positive().describe('Pull request number (e.g. 42).'),
    },
    async ({ repo, pr }) => {
      try {
        const pullResult = await resolvePullId(client, repo, pr);
        if ('error' in pullResult) return toolError(pullResult.error);

        const blast = await client.getBlast(pullResult.pullId);
        return toolOk(blast);
      } catch (e) {
        if (e instanceof ApiError) {
          return toolError(`DevDigest API unreachable at ${config.apiUrl} — start it with ./scripts/dev.sh.`);
        }
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
