/* hooks/onboarding.ts — TanStack Query hooks for the per-repo Onboarding Tour.
   Covers: fetching the cached artifact (GET) and triggering/force-triggering
   generation (POST).

   Endpoint conventions (per the implementation plan T11/T12):
     Fetch cached  : GET  /repos/:repoId/onboarding
     Generate tour : POST /repos/:repoId/onboarding  { force?: boolean }

   "No tour yet" state:
     `useOnboarding` returns `data: null` (not an error) when the server reports
     a 404 — meaning no generation has run yet for this repo. The page can test
     `data === null` to show the first-visit Generate affordance, and `isError`
     to show a genuine error state. An error with `status === 404` is absorbed
     inside `fetchOnboarding` and surfaced as `null`.
*/
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  onboardingQueryKeys,
  fetchOnboarding,
  generateOnboarding,
} from "../api";
import type { OnboardingArtifact } from "@devdigest/shared";

// Re-export key factory so consumers can reference it for prefetch / optimistic
// updates without importing from the lower-level api module.
export { onboardingQueryKeys };

// ---- Query — fetch cached tour ----

/**
 * Fetch the onboarding tour artifact for the given repo.
 *
 * Return value summary:
 *   `data === undefined` — query loading / disabled
 *   `data === null`      — no tour generated yet (first-visit generate state)
 *   `data`               — `OnboardingArtifact` — tour exists and is ready
 *   `isError === true`   — genuine fetch failure (network, 5xx, etc.)
 *
 * Query is disabled when `repoId` is falsy.
 */
export function useOnboarding(repoId: string | null | undefined): ReturnType<
  typeof useQuery<OnboardingArtifact | null>
> {
  return useQuery<OnboardingArtifact | null>({
    queryKey: onboardingQueryKeys.tour(repoId ?? ""),
    queryFn: () => fetchOnboarding(repoId!),
    enabled: !!repoId,
  });
}

// ---- Mutation — generate / regenerate tour ----

/**
 * Mutation that POSTs to the generate endpoint for the given repo.
 *
 * On success the onboarding query cache is invalidated, causing `useOnboarding`
 * to refetch and display the freshly generated (or force-regenerated) artifact.
 *
 * Usage:
 *   ```tsx
 *   const generate = useGenerateOnboarding(repoId);
 *   // first-visit
 *   generate.mutate({});
 *   // explicit regenerate
 *   generate.mutate({ force: true });
 *   ```
 */
export function useGenerateOnboarding(repoId: string) {
  const qc = useQueryClient();
  return useMutation<OnboardingArtifact, Error, { force?: boolean }>({
    mutationFn: (variables: { force?: boolean }) =>
      generateOnboarding(repoId, variables),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: onboardingQueryKeys.tour(repoId) });
    },
  });
}
