/* hooks/project-context.ts — TanStack Query hooks for the Project Context feature.
   Covers: document discovery, document preview, and agent/skill attachment persistence.

   Endpoint conventions (per the implementation plan):
     Discovery  : GET  /project-context/documents?repoId=<id>
     Preview    : GET  /project-context/documents/preview?path=<encoded-path>
     Agent docs : GET  /agents/:id/documents
                  POST /agents/:id/documents  { paths: string[] }
     Skill docs : GET  /skills/:id/documents
                  POST /skills/:id/documents  { paths: string[] }

   If the server implementation (T7) uses a different route shape, reconcile here.
*/
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  DiscoveryResponse,
  DocumentPreview,
  DocumentAttachment,
} from "@devdigest/shared";

// ---- Query-key constants (unique, referenced by siblings for invalidation) ----
export const projectContextKeys = {
  documents: (repoId: string) => ["project-context-documents", repoId] as const,
  preview: (path: string, repoId?: string | null) =>
    ["project-context-preview", path, repoId ?? null] as const,
  agentDocuments: (agentId: string) => ["agent-documents", agentId] as const,
  skillDocuments: (skillId: string) => ["skill-documents", skillId] as const,
} as const;

// ---- Discovery ----

/** List all .md files under specs/docs/insights in the repo clone (stat-only). */
export function useDiscoveredDocuments(repoId: string | null | undefined) {
  return useQuery({
    queryKey: repoId ? projectContextKeys.documents(repoId) : ["project-context-documents", null],
    queryFn: () =>
      api.get<DiscoveryResponse>(
        `/project-context/documents?repoId=${encodeURIComponent(repoId!)}`
      ),
    enabled: !!repoId,
  });
}

// ---- Preview ----

/** Fetch the raw markdown content of a single discovered document.
 *  Pass `repoId` to pin the request to a specific repo and isolate the cache key. */
export function useDocumentPreview(
  path: string | null | undefined,
  repoId?: string | null,
) {
  return useQuery({
    queryKey: path
      ? projectContextKeys.preview(path, repoId)
      : ["project-context-preview", null],
    queryFn: () => {
      const params = new URLSearchParams({ path: path! });
      if (repoId) params.set("repoId", repoId);
      return api.get<DocumentPreview>(
        `/project-context/documents/preview?${params.toString()}`,
      );
    },
    enabled: !!path,
  });
}

// ---- Agent documents ----

/** Return the ordered list of document paths attached to an agent. */
export function useAgentDocuments(agentId: string | null | undefined) {
  return useQuery({
    queryKey: agentId
      ? projectContextKeys.agentDocuments(agentId)
      : ["agent-documents", null],
    queryFn: () =>
      api.get<DocumentAttachment>(`/agents/${agentId}/documents`),
    enabled: !!agentId,
  });
}

/**
 * Replace-set the ordered document paths for an agent (AC-5, AC-7).
 * `repoId` is included in the POST body so the server resolves the right repo
 * deterministically in multi-repo workspaces.
 * On success, invalidates the agent's document list AND the discovery query
 * (so the "used by N agents" badge refreshes — AC-24).
 */
export function useSetAgentDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      paths,
      repoId,
    }: {
      agentId: string;
      paths: string[];
      repoId?: string | null;
    }) =>
      api.post<DocumentAttachment>(`/agents/${agentId}/documents`, {
        paths,
        repoId: repoId ?? undefined,
      }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: projectContextKeys.agentDocuments(agentId) });
      // Refresh all discovery results so used_by_agents counts are up to date (AC-24).
      qc.invalidateQueries({ queryKey: ["project-context-documents"] });
    },
  });
}

// ---- Skill documents ----

/** Return the ordered list of document paths attached to a skill. */
export function useSkillDocuments(skillId: string | null | undefined) {
  return useQuery({
    queryKey: skillId
      ? projectContextKeys.skillDocuments(skillId)
      : ["skill-documents", null],
    queryFn: () =>
      api.get<DocumentAttachment>(`/skills/${skillId}/documents`),
    enabled: !!skillId,
  });
}

/**
 * Replace-set the ordered document paths for a skill (AC-6, AC-7).
 * `repoId` is included in the POST body so the server resolves the right repo
 * deterministically in multi-repo workspaces.
 * On success, invalidates the skill's document list AND the discovery query
 * (so the "used by N agents" badge refreshes — AC-24).
 */
export function useSetSkillDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      skillId,
      paths,
      repoId,
    }: {
      skillId: string;
      paths: string[];
      repoId?: string | null;
    }) =>
      api.post<DocumentAttachment>(`/skills/${skillId}/documents`, {
        paths,
        repoId: repoId ?? undefined,
      }),
    onSuccess: (_data, { skillId }) => {
      qc.invalidateQueries({ queryKey: projectContextKeys.skillDocuments(skillId) });
      // Refresh all discovery results so used_by_agents counts are up to date (AC-24).
      qc.invalidateQueries({ queryKey: ["project-context-documents"] });
    },
  });
}
