import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Client } from '../http/client.js';
import { ApiError } from '../http/client.js';
import { toolOk, toolError } from '../format.js';
import { compactConvention } from '../format.js';
import { resolveRepoId } from '../core/resolve.js';
import { config } from '../config.js';

export function registerGetConventions(server: McpServer, client: Client): void {
  server.tool(
    'devdigest_get_conventions',
    "Get the coding conventions extracted for a repository (rule, file, confidence, accepted). Use this to justify or check a finding against the repository's house rules.",
    {
      repo: z.string().min(1).describe("Repository as 'owner/name', or just the name if unambiguous."),
    },
    async ({ repo }) => {
      try {
        const repoResult = await resolveRepoId(client, repo);
        if ('error' in repoResult) return toolError(repoResult.error);

        const conventions = await client.listConventions(repoResult.repoId);
        return toolOk({
          repo: repoResult.fullName,
          conventions: conventions.map(compactConvention),
        });
      } catch (e) {
        if (e instanceof ApiError) {
          return toolError(`DevDigest API unreachable at ${config.apiUrl} — start it with ./scripts/dev.sh.`);
        }
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
