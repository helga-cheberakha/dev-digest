/* api.ts — typed fetch client for the F1 Fastify engine (localhost:3001).
   All hooks build on `apiFetch`. Errors are normalized to ApiError so the
   error-UX taxonomy (toast/inline/full-screen) can branch on status. */

import type {
  OnboardingArtifact,
  EvalCase,
  EvalCaseInput,
  EvalCaseListItem,
  EvalRunResult,
  EvalRun,
  EvalRunBatch,
  EvalCompare,
  EvalDashboard,
  EvalBenchmark,
  Agent,
} from "@devdigest/shared";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — otherwise a
        // body-less POST/PUT (e.g. tour generate, refresh, reindex) trips
        // Fastify's "Body cannot be empty when content-type is application/json".
        ...(init?.body != null ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    // network failure / API down → full-screen error candidate
    throw new ApiError(
      `Cannot reach the DevDigest engine at ${API_BASE}. Is the API running?`,
      0,
      "network_error",
      e
    );
  }

  if (!res.ok) {
    let code: string | undefined;
    let message = `${res.status} ${res.statusText}`;
    let details: unknown;
    try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, code, details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

// ---- Onboarding Tour ----

/** Stable query-key factory for the onboarding tour cache. */
export const onboardingQueryKeys = {
  tour: (repoId: string) => ["onboarding", repoId] as const,
} as const;

/**
 * Fetch the cached onboarding artifact for a repo.
 *
 * Returns `null` — treated as a successful "no tour yet" state — when the
 * server responds 404 (no generation has run). All other errors are re-thrown
 * so TanStack Query puts the query into its error state (network failure, 5xx, etc.).
 *
 * This distinguishes "first-visit generate" from a genuine fetch error, letting
 * the page render an explicit Generate affordance instead of an error message.
 */
export async function fetchOnboarding(
  repoId: string,
): Promise<OnboardingArtifact | null> {
  try {
    return await apiFetch<OnboardingArtifact>(`/repos/${repoId}/onboarding`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Trigger (or force-re-trigger) onboarding generation for a repo.
 *
 * Always sends a JSON body (`{}` at minimum) so `apiFetch` sets the
 * `application/json` content-type header — which Fastify requires on POST
 * routes that declare a body schema.
 *
 * @param body.force - When `true`, bypasses the SHA-match cache and generates
 *   a fresh tour even when the repo HEAD has not changed (AC-15).
 */
export async function generateOnboarding(
  repoId: string,
  body: { force?: boolean },
): Promise<OnboardingArtifact> {
  return api.post<OnboardingArtifact>(`/repos/${repoId}/onboarding`, body);
}

// ---- Eval Pipeline ----

/** Stable query-key factory for the eval pipeline cache. */
export const evalQueryKeys = {
  cases: (agentId: string) => ["eval-cases", agentId] as const,
  batches: (agentId: string) => ["eval-batches", agentId] as const,
  compare: (agentId: string, a: string, b: string) =>
    ["eval-compare", agentId, a, b] as const,
  dashboard: (agentId?: string) => ["eval-dashboard", agentId] as const,
  skillCases: (skillId: string) => ["eval-cases", "skill", skillId] as const,
  skillDashboard: (skillId: string) =>
    ["eval-dashboard", "skill", skillId] as const,
  skillBatches: (skillId: string) => ["eval-batches", "skill", skillId] as const,
  skillCompare: (skillId: string, a: string, b: string) =>
    ["eval-compare", "skill", skillId, a, b] as const,
} as const;

/**
 * Draft an eval case from an existing finding.
 *
 * Hits `POST /findings/:id/eval-case`. The returned EvalCaseInput is NEVER
 * persisted — it is a preview that the caller may edit before calling
 * `createEvalCase`. Do not confuse with `createEvalCase` which always writes
 * a DB row.
 *
 * Sends `{}` so Fastify sets `application/json` on the body-schema route.
 */
export async function draftEvalCaseFromFinding(
  findingId: string,
): Promise<EvalCaseInput> {
  return api.post<EvalCaseInput>(`/findings/${findingId}/eval-case`, {});
}

/**
 * Persist an eval case (new DB row).
 *
 * Used for both a manually-authored case AND saving a (possibly-edited)
 * finding-derived draft returned by `draftEvalCaseFromFinding`.
 */
export async function createEvalCase(input: EvalCaseInput): Promise<EvalCase> {
  return api.post<EvalCase>(`/eval-cases`, input);
}

/** List all eval cases for an agent, each augmented with the latest run outcome. */
export async function fetchEvalCases(agentId: string): Promise<EvalCaseListItem[]> {
  return api.get<EvalCaseListItem[]>(`/agents/${agentId}/eval-cases`);
}

/** Delete an eval case (and its run history, cascaded server-side). */
export async function deleteEvalCase(caseId: string): Promise<void> {
  return api.del<void>(`/eval-cases/${caseId}`);
}

/**
 * Run a single eval case and persist the result.
 *
 * Sends `{}` so Fastify sets `application/json` on the body-schema route.
 */
export async function runEvalCase(caseId: string): Promise<EvalRunResult> {
  return api.post<EvalRunResult>(`/eval-cases/${caseId}/run`, {});
}

/**
 * Run all eval cases for an agent as a batch.
 *
 * Sends `{}` so Fastify sets `application/json` on the body-schema route.
 */
export async function runEvalBatch(agentId: string): Promise<EvalRun> {
  return api.post<EvalRun>(`/agents/${agentId}/eval-runs`, {});
}

/** List batch-run history for an agent (newest first). */
export async function fetchEvalBatches(agentId: string): Promise<EvalRunBatch[]> {
  return api.get<EvalRunBatch[]>(`/agents/${agentId}/eval-batches`);
}

/** Compare two batch runs for an agent side-by-side. */
export async function fetchEvalCompare(
  agentId: string,
  batchIdA: string,
  batchIdB: string,
): Promise<EvalCompare> {
  return api.get<EvalCompare>(
    `/agents/${agentId}/eval-compare?a=${encodeURIComponent(batchIdA)}&b=${encodeURIComponent(batchIdB)}`,
  );
}

/**
 * Fetch the eval dashboard aggregate.
 *
 * Pass `agentId` to scope to a single agent; omit for the workspace-wide view.
 */
export async function fetchEvalDashboard(agentId?: string): Promise<EvalDashboard> {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
  return api.get<EvalDashboard>(`/eval/dashboard${qs}`);
}

/** List all eval cases for a skill, each augmented with the latest run outcome. */
export async function fetchSkillEvalCases(
  skillId: string,
): Promise<EvalCaseListItem[]> {
  return api.get<EvalCaseListItem[]>(`/skills/${skillId}/eval-cases`);
}

/**
 * Run all eval cases for a skill as a batch.
 *
 * Sends `{}` so Fastify sets `application/json` on the body-schema route.
 */
export async function runSkillEvalBatch(skillId: string): Promise<EvalRun> {
  return api.post<EvalRun>(`/skills/${skillId}/eval-runs`, {});
}

/**
 * Fetch the eval dashboard aggregate scoped to a single skill.
 */
export async function fetchSkillEvalDashboard(
  skillId: string,
): Promise<EvalDashboard> {
  return api.get<EvalDashboard>(
    `/eval/dashboard?skillId=${encodeURIComponent(skillId)}`,
  );
}

/**
 * Run a benchmark comparison for a skill (candidate vs. baseline).
 *
 * Sends `{}` so Fastify sets `application/json` on the body-schema route.
 */
export async function runSkillEvalBenchmark(
  skillId: string,
): Promise<EvalBenchmark> {
  return api.post<EvalBenchmark>(`/skills/${skillId}/eval-benchmark`, {});
}

/** List batch-run history for a skill (newest first). */
export async function fetchSkillEvalBatches(
  skillId: string,
): Promise<EvalRunBatch[]> {
  return api.get<EvalRunBatch[]>(`/skills/${skillId}/eval-batches`);
}

/** Compare two batch runs for a skill side-by-side. */
export async function fetchSkillEvalCompare(
  skillId: string,
  a: string,
  b: string,
): Promise<EvalCompare> {
  return api.get<EvalCompare>(
    `/skills/${skillId}/eval-compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
  );
}

/**
 * Promote a past agent version by restoring its system_prompt.
 *
 * Client-side compose: fetches the version snapshot via
 * `GET /agents/:id/versions/:version`, then writes the snapshot's
 * `system_prompt` back with `PUT /agents/:id`. No new server route.
 */
export async function promoteVersion(
  agentId: string,
  version: number,
): Promise<Agent> {
  const snapshot = await api.get<{ config: { system_prompt: string } }>(
    `/agents/${agentId}/versions/${version}`,
  );
  return api.put<Agent>(`/agents/${agentId}`, {
    system_prompt: snapshot.config.system_prompt,
  });
}
