/* hooks/multiAgent.ts — TanStack Query hooks for multi-agent review runs.
   Pattern mirrors reviews.ts: call api.get / api.post directly, no per-endpoint
   wrappers in api.ts. */
"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentEstimate, MultiAgentRun, MultiAgentRunRequest } from "@devdigest/shared";

// ---- Pre-run estimates ----

/** Cost/duration estimates for all agents before a multi-agent run is launched. */
export function useAgentEstimates() {
  return useQuery({
    queryKey: ["agent-estimates"],
    queryFn: () => api.get<AgentEstimate[]>("/agent-estimates"),
  });
}

// ---- Launch multi-agent run ----

export interface LaunchMultiAgentRunInput {
  prId: string;
  agent_ids: string[];
}

/**
 * Launch a multi-agent review. Returns the parent run id and the individual
 * agent run ids. Navigate to /multi-agent/<id> after a successful launch.
 *
 * N=1 must NOT go through this endpoint — use useRunReview() for the single-
 * agent path to avoid creating a multi_agent_runs parent record.
 */
export function useLaunchMultiAgentRun() {
  return useMutation({
    mutationFn: ({ prId, agent_ids }: LaunchMultiAgentRunInput) =>
      api.post<{ id: string; run_ids: string[] }>(
        `/pulls/${prId}/multi-agent-run`,
        { agent_ids } satisfies MultiAgentRunRequest,
      ),
  });
}

// ---- Fetch a completed multi-agent run (for T4/T5 results page) ----

/**
 * Fetch a multi-agent run by id. Used on the /multi-agent/<id> results page
 * (built in a later task). Created here so T4/T5 can import it immediately.
 */
export function useMultiAgentRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", runId],
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${runId}`),
    enabled: !!runId,
  });
}
