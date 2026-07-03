import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toolOk } from '../format.js';

export function registerGetBlastRadius(server: McpServer): void {
  server.tool(
    'devdigest_get_blast_radius',
    "STUB — not yet implemented. Intended to map which files and symbols a PR's changes affect. Returns a placeholder, not real data. Do not rely on its output and do not block your report on it — note the limitation and continue.",
    {
      repo: z.string().optional().describe("(Accepted but ignored — stub.) Repository as 'owner/name'."),
      pr:   z.number().int().optional().describe('(Accepted but ignored — stub.) Pull request number.'),
    },
    async () => toolOk({
      status: 'not_implemented',
      message: 'Blast radius not yet available — proceed without it, note the limitation.',
    }),
  );
}
