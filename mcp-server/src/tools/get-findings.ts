import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Client } from '../http/client.js';
import { ApiError } from '../http/client.js';
import { toolOk, toolError } from '../format.js';
import { resolvePullId } from '../core/resolve.js';
import { pickReview, shapeFindings } from '../core/findings.js';
import { config } from '../config.js';

export function registerGetFindings(server: McpServer, client: Client): void {
  server.tool(
    'devdigest_get_findings',
    "Get the verdict and findings of a completed review for a pull request. Identify the PR with repo + pr; optionally pass run_id to select a specific run (otherwise the latest review is returned). Defaults to a concise summary (top findings + counts by severity); pass response_format:'detailed' for full fields, and use offset/limit to page through large result sets.",
    {
      repo: z.string().min(1).describe("Repository as 'owner/name' (e.g. 'octocat/hello'), or just the name if unambiguous."),
      pr: z.number().int().positive().describe('Pull request number (e.g. 42).'),
      run_id: z.string().optional().describe('Optional: select a specific run (e.g. the run_id returned by devdigest_run_agent_on_pr); omit to get the latest review.'),
      response_format: z.enum(['concise', 'detailed']).default('concise').describe("'concise' (default): severity, title, file:line, rationale. 'detailed': also suggestion, confidence, line range."),
      offset: z.number().int().min(0).default(0).describe('Pagination offset over findings (default 0).'),
      limit: z.number().int().positive().max(100).optional().describe('Max findings to return (default 10 for concise, 20 for detailed); keeps the response small.'),
    },
    async ({ repo, pr, run_id, response_format, offset, limit }) => {
      try {
        const pullResult = await resolvePullId(client, repo, pr);
        if ('error' in pullResult) return toolError(pullResult.error);

        const reviews = await client.listReviews(pullResult.pullId);
        const review = pickReview(reviews, { runId: run_id });

        if (!review) {
          return toolError(
            'No completed review yet — run devdigest_run_agent_on_pr first or wait and call devdigest_get_findings with the run_id.',
          );
        }

        const resolvedLimit = limit ?? (response_format === 'detailed' ? 20 : 10);
        const shaped = shapeFindings(review, {
          format: response_format,
          offset,
          limit: resolvedLimit,
        });

        return toolOk(shaped);
      } catch (e) {
        if (e instanceof ApiError) {
          return toolError(`DevDigest API unreachable at ${config.apiUrl} — start it with ./scripts/dev.sh.`);
        }
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
