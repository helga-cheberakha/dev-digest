/* hooks/ci.ts — TanStack Query hooks for CI export and CI runs. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchCiRuns,
  fetchCiInstallations,
  refreshCiRuns,
  exportCi,
  ciQueryKeys,
} from "../api";
import type { CiExportInputBody } from "@devdigest/shared";

/** All CI runs (newest first; filtered client-side by the view). */
export function useCiRuns() {
  return useQuery({
    queryKey: ciQueryKeys.runs(),
    queryFn: fetchCiRuns,
  });
}

/**
 * Mutation: trigger a refresh from GitHub Actions artifacts.
 * On success, invalidates the ci-runs list so it re-fetches automatically.
 */
export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: refreshCiRuns,
    onSuccess: () => qc.invalidateQueries({ queryKey: ciQueryKeys.runs() }),
  });
}

/** List CI installations for a specific agent. */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ciQueryKeys.installations(agentId ?? ""),
    queryFn: () => fetchCiInstallations(agentId!),
    enabled: !!agentId,
  });
}

/**
 * Mutation: export an agent's CI config, optionally opening a PR.
 * On success, invalidates the ci-installations list for that agent so
 * the CI tab reflects the new installation immediately.
 */
export function useExportCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: CiExportInputBody }) =>
      exportCi(agentId, input),
    onSuccess: (_data, { agentId }) =>
      qc.invalidateQueries({ queryKey: ciQueryKeys.installations(agentId) }),
  });
}
