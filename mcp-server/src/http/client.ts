import type {
  Agent,
  Repo,
  PrMeta,
  ReviewRunResponse,
  RunSummary,
  ReviewRecord,
  RunTrace,
  ConventionCandidate,
  BlastRadius,
} from '@devdigest/shared';

import { config } from '../config.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'ApiError';
  }
}

export type Client = ReturnType<typeof createClient>;

export function createClient(apiUrl?: string) {
  const base = apiUrl ?? config.apiUrl;

  const g = <T>(path: string): Promise<T> => {
    const url = `${base}${path}`;
    return fetch(url).then((r) => {
      if (!r.ok) throw new ApiError(r.status, url);
      return r.json() as Promise<T>;
    });
  };

  const p = <T>(path: string, body: unknown): Promise<T> => {
    const url = `${base}${path}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => {
      if (!r.ok) throw new ApiError(r.status, url);
      return r.json() as Promise<T>;
    });
  };

  return {
    listAgents: () => g<Agent[]>('/agents'),
    listRepos: () => g<Repo[]>('/repos'),
    listPulls: (repoId: string) => g<PrMeta[]>(`/repos/${repoId}/pulls`),
    triggerReview: (pullId: string, agentId: string) =>
      p<ReviewRunResponse>(`/pulls/${pullId}/review`, { agentId }),
    listRuns: (pullId: string) => g<RunSummary[]>(`/pulls/${pullId}/runs`),
    listReviews: (pullId: string) => g<ReviewRecord[]>(`/pulls/${pullId}/reviews`),
    getTrace: (runId: string) => g<RunTrace>(`/runs/${runId}/trace`),
    listConventions: (repoId: string) =>
      g<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    getBlast: (pullId: string) => g<BlastRadius>(`/pulls/${pullId}/blast`),
  };
}
