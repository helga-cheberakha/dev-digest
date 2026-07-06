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
    'Get the blast radius of a pull request: changed symbols, callers, endpoints. Pass pr_id (internal UUID) OR repo+pr (owner/name + number). Returns changed_symbols, downstream callers, endpoints_affected, and prior_prs.',
    {
      repo:  z.string().min(1).optional().describe("Repository as 'owner/name'. Required unless pr_id is given."),
      pr:    z.number().int().positive().optional().describe('Pull request number. Required unless pr_id is given.'),
      pr_id: z.string().uuid().optional().describe('Internal PR UUID (skips repo+pr lookup).'),
    },
    async ({ repo, pr, pr_id }) => {
      try {
        let pullId: string;
        if (pr_id) {
          pullId = pr_id;
        } else if (repo && pr != null) {
          const pullResult = await resolvePullId(client, repo, pr);
          if ('error' in pullResult) return toolError(pullResult.error);
          pullId = pullResult.pullId;
        } else {
          return toolError('Provide either pr_id or both repo and pr.');
        }
        const blast = await client.getBlast(pullId);
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
