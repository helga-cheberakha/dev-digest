/* hooks/agentPerformance.ts — TanStack Query hooks for the Agent Performance dashboard. */
"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchAgentPerformance,
  fetchAgentStats,
  fetchAgentRuns,
  agentPerfQueryKeys,
} from "../api";
import type { PerfWindow } from "../api";

/**
 * Cross-agent performance dashboard data (`GET /agents/performance`).
 *
 * The query key embeds the serialized window so switching the period picker
 * triggers an automatic refetch rather than serving the previously-cached window.
 */
export function useAgentPerformance(window: PerfWindow) {
  return useQuery({
    queryKey: agentPerfQueryKeys.performance(window),
    queryFn: () => fetchAgentPerformance(window),
    staleTime: 60_000,
  });
}

/**
 * Per-agent quality stats for a single agent (`GET /agents/:id/stats`).
 *
 * The query key embeds both `agentId` and the serialized window so this
 * query is independent across agents and time windows.
 */
export function useAgentStats(agentId: string, window: PerfWindow) {
  return useQuery({
    queryKey: agentPerfQueryKeys.stats(agentId, window),
    queryFn: () => fetchAgentStats(agentId, window),
    enabled: !!agentId,
    staleTime: 60_000,
  });
}

/**
 * Paginated run history for a single agent (`GET /agents/:id/runs`).
 *
 * The query key embeds `agentId`, the serialized window, `page`, and `limit`
 * so any change to the period picker or pagination triggers an independent refetch.
 * `placeholderData: keepPreviousData` prevents a loading flash when paging through results.
 */
export function useAgentRuns(
  agentId: string,
  window: PerfWindow,
  page: number,
  limit: number,
) {
  return useQuery({
    queryKey: agentPerfQueryKeys.runs(agentId, window, page, limit),
    queryFn: () => fetchAgentRuns(agentId, window, page, limit),
    enabled: !!agentId,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
