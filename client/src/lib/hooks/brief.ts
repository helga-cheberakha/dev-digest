/* hooks/brief.ts — React Query hooks for A3's Why+Risk Brief, Blast radius
   and git-why (§12). Types come from @devdigest/shared. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius, Brief } from "@devdigest/shared";
import type { WhyTimeline } from "@devdigest/shared/contracts/why";

/** POST /pulls/:id/brief { force: false } → Brief {what, why, risk_level,
 *  risks, review_focus} (persisted, cached server-side by head_sha). A
 *  body-less/`{force:false}` POST is idempotent server-side — a cache hit
 *  returns without a new LLM call — but `refetchOnWindowFocus` stays off so
 *  a window-focus refetch never fires a background POST client-side either
 *  (the LLM-count invariant should not lean on server-side idempotency
 *  alone). */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.post<Brief>(`/pulls/${prId}/brief`, { force: false }),
    enabled: !!prId,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
}

/** POST /pulls/:id/brief { force: true } → regenerate the Brief regardless
 *  of the cached `head_sha`, overwriting the cache (AC-8/AC-15). */
export function useRegenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Brief>(`/pulls/${prId}/brief`, { force: true }),
    onSuccess: (brief) => {
      qc.setQueryData(["brief", prId], brief);
    },
  });
}

/** GET /pulls/:id/blast → BlastRadius (changed symbols + downstream). */
export function usePrBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
    retry: false,
  });
}

/** GET /pulls/:id/why?file&line → WhyTimeline for a specific line. */
export function usePrWhy(
  prId: string | null | undefined,
  loc: { file: string; line: number } | null,
) {
  return useQuery({
    queryKey: ["why", prId, loc?.file, loc?.line],
    queryFn: () =>
      api.get<WhyTimeline>(
        `/pulls/${prId}/why?file=${encodeURIComponent(loc!.file)}&line=${loc!.line}`,
      ),
    enabled: !!prId && !!loc,
    retry: false,
  });
}
