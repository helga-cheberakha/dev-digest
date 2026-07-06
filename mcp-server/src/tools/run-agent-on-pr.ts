import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Client } from '../http/client.js';
import { toolOk, toolError } from '../format.js';
import { resolvePullId } from '../core/resolve.js';
import { pickReview, shapeFindings } from '../core/findings.js';
import { runReviewAndWait } from '../core/run-review.js';
import { config } from '../config.js';

export function registerRunAgentOnPr(server: McpServer, client: Client): void {
  server.tool(
    'devdigest_run_agent_on_pr',
    'Run a DevDigest AI agent on a pull request and wait for the result. Returns verdict, score, and top findings. Specify repo as \'owner/name\' or just \'name\'. Use devdigest_list_agents to find valid agent ids.',
    {
      repo: z.string().describe('Repo as owner/name or just name'),
      pr: z.number().int().positive().describe('PR number'),
      agent: z.string().describe('Agent id or name from devdigest_list_agents'),
    },
    async ({ repo, pr, agent }) => {
      // 1. Resolve repo + PR
      const pullResult = await resolvePullId(client, repo, pr);
      if ('error' in pullResult) {
        return toolError(pullResult.error);
      }
      const { pullId } = pullResult;

      // 2. Resolve agent
      const agents = await client.listAgents();
      let agentRecord = agents.find(a => a.id === agent);
      if (!agentRecord) {
        agentRecord = agents.find(a => a.name.toLowerCase() === agent.toLowerCase());
      }
      if (!agentRecord) {
        return toolError(`Agent not found: "${agent}". Call devdigest_list_agents to see available ids.`);
      }
      if (!agentRecord.enabled) {
        return toolError(`Agent "${agentRecord.name}" is disabled. Call devdigest_list_agents to see enabled agents.`);
      }

      // 3. Run + wait
      const result = await runReviewAndWait(
        client,
        { pullId, agentId: agentRecord.id },
        config,
        { pickReview, shapeFindings },
      );

      // 4. Map result
      if (result.kind === 'done') {
        return toolOk(result);
      }
      if (result.kind === 'running') {
        return toolOk({
          status: 'running',
          run_id: result.run_id,
          message: 'Review is still running. Call devdigest_get_findings with run_id to check later.',
        });
      }
      // kind === 'failed'
      return toolError('Review failed: ' + result.error);
    },
  );
}
