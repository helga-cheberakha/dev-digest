import { describe, it, expect, vi } from 'vitest';
import type { Octokit } from 'octokit';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';

describe('CiWorkflowRun methods — mock-backed', () => {
  it('listWorkflowRuns returns seeded CiWorkflowRun fixtures', async () => {
    const gh = new MockGitHubClient({
      workflowRuns: [
        {
          runId: 42,
          status: 'completed',
          conclusion: 'success',
          htmlUrl: 'https://github.com/acme/api/actions/runs/42',
          headBranch: 'main',
        },
      ],
    });
    const runs = await gh.listWorkflowRuns({ owner: 'acme', name: 'api' }, 'devdigest-review.yml');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.runId).toBe(42);
    expect(runs[0]!.conclusion).toBe('success');
    expect(runs[0]!.headBranch).toBe('main');
  });

  it('listWorkflowRuns returns default fixture when no seed provided', async () => {
    const gh = new MockGitHubClient();
    const runs = await gh.listWorkflowRuns({ owner: 'a', name: 'b' }, 'devdigest.yml');
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0]).toHaveProperty('runId');
    expect(runs[0]).toHaveProperty('htmlUrl');
  });

  it('downloadRunArtifact returns seeded Buffer with artifact bytes', async () => {
    const payload = JSON.stringify({
      findings_count: 3,
      cost_usd: 0.02,
      agent: 'security-reviewer',
      duration_ms: 12000,
    });
    const gh = new MockGitHubClient({ artifactBuffer: Buffer.from(payload) });
    const buf = await gh.downloadRunArtifact(
      { owner: 'acme', name: 'api' },
      42,
      'devdigest-result',
    );
    expect(buf).not.toBeNull();
    const parsed = JSON.parse(buf!.toString()) as Record<string, unknown>;
    expect(parsed.findings_count).toBe(3);
    expect(parsed.agent).toBe('security-reviewer');
  });

  it('downloadRunArtifact returns null when artifactBuffer is explicitly null', async () => {
    const gh = new MockGitHubClient({ artifactBuffer: null });
    const result = await gh.downloadRunArtifact(
      { owner: 'acme', name: 'api' },
      42,
      'devdigest-result',
    );
    expect(result).toBeNull();
  });
});

describe('OctokitGitHubClient.downloadRunArtifact — size guard', () => {
  it('returns null for an artifact exceeding the 20 MB cap without calling download', async () => {
    const mockOctokit = {
      rest: {
        actions: {
          listWorkflowRunArtifacts: vi.fn().mockResolvedValue({
            data: {
              artifacts: [
                {
                  id: 99,
                  name: 'devdigest-result',
                  // 21 MB — just over the 20 MB cap
                  size_in_bytes: 21 * 1024 * 1024,
                },
              ],
            },
          }),
        },
      },
      // request must NOT be called when size exceeds cap
      request: vi.fn(),
    } as unknown as Octokit;

    const client = new OctokitGitHubClient('fake-token', mockOctokit);
    const result = await client.downloadRunArtifact(
      { owner: 'acme', name: 'api' },
      123,
      'devdigest-result',
    );

    expect(result).toBeNull();
    // The download request must never be invoked for oversized artifacts.
    expect(mockOctokit.request).not.toHaveBeenCalled();
  });

  it('returns null when the named artifact is not found in the run', async () => {
    const mockOctokit = {
      rest: {
        actions: {
          listWorkflowRunArtifacts: vi.fn().mockResolvedValue({
            data: { artifacts: [] },
          }),
        },
      },
      request: vi.fn(),
    } as unknown as Octokit;

    const client = new OctokitGitHubClient('fake-token', mockOctokit);
    const result = await client.downloadRunArtifact(
      { owner: 'acme', name: 'api' },
      123,
      'devdigest-result',
    );

    expect(result).toBeNull();
    expect(mockOctokit.request).not.toHaveBeenCalled();
  });
});
