"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Convention, ExtractConventionsResult } from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<Convention[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ExtractConventionsResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export interface UpdateConventionInput {
  status?: "pending" | "accepted" | "rejected";
  rule?: string;
  snippet?: string;
}

export function useUpdateConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateConventionInput }) =>
      api.put<Convention>(`/repos/${repoId}/conventions/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}
