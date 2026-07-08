/* api.ts — typed fetch client for the F1 Fastify engine (localhost:3001).
   All hooks build on `apiFetch`. Errors are normalized to ApiError so the
   error-UX taxonomy (toast/inline/full-screen) can branch on status. */

import type { OnboardingArtifact } from "@devdigest/shared";

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
