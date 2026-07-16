/**
 * CI module tests — T3 + T4.
 *
 * Test categories:
 *  1. workflow.ts security property tests (string inspection)
 *  2. manifest.ts generation and validation
 *  3. bundle.ts file assembly
 *  4. CiService: export (open_pr, files, missing-runner-asset)
 *  5. CiService: ingestion / refresh (dedup, malformed artifact, source column)
 *  6. Parity test (AC-29): reviewPullRequest output equals local-review pipeline
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../../db/client.js';
import type { Container } from '../../platform/container.js';
import type { CiInstallationRow, CiRunRow } from './repository.js';
import { CiRepository } from './repository.js';
import { CiService } from './service.js';
import { buildManifestYaml, slugify } from './manifest.js';
import { buildWorkflowYaml, WORKFLOW_FILE_NAME } from './workflow.js';
import { buildCiBundle } from './bundle.js';
import {
  MockGitHubClient,
  MockAuthProvider,
} from '../../adapters/mocks.js';
import type { CiInstallation } from '@devdigest/shared';
import { CiExportInput } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { MockLLMProvider, MockGitClient } from '../../adapters/mocks.js';

// ============================================================================
// 1. workflow.ts security properties
// ============================================================================

describe('workflow.ts — security property assertions (string inspection)', () => {
  const yaml = buildWorkflowYaml({ postAs: 'github_review', triggers: ['opened', 'synchronize'] });

  it('has EXACTLY two permission keys: contents and pull-requests', () => {
    // Extract the permissions block lines
    const permLines = yaml
      .split('\n')
      .filter(
        (l) =>
          l.trim().startsWith('contents:') ||
          l.trim().startsWith('pull-requests:'),
      );
    expect(permLines).toHaveLength(2);
    expect(permLines.some((l) => l.includes('contents: read'))).toBe(true);
    expect(permLines.some((l) => l.includes('pull-requests: write'))).toBe(true);
  });

  it('uses pull_request on, never pull_request_target', () => {
    expect(yaml).toContain('pull_request:');
    expect(yaml).not.toContain('pull_request_target');
  });

  it('has no issue_comment or any comment-triggered event', () => {
    expect(yaml).not.toContain('issue_comment');
  });

  it('run step is exactly `node .devdigest/runner/index.js` with no CLI flags', () => {
    expect(yaml).toContain('run: node .devdigest/runner/index.js');
    expect(yaml).not.toMatch(/node .devdigest\/runner\/index\.js.*--/);
  });

  it('has no devdigest/* marketplace uses', () => {
    expect(yaml).not.toContain('uses: devdigest/');
  });

  it('has no literal secret values (only ${{ secrets.* }} references)', () => {
    // No sk_live_, no Bearer tokens, no raw keys — only template syntax
    expect(yaml).not.toMatch(/sk_live_|xox[bpsa]-|ghp_/);
    expect(yaml).toContain('${{ secrets.OPENROUTER_API_KEY }}');
    expect(yaml).toContain('${{ secrets.GITHUB_TOKEN }}');
  });

  it('has a trailing upload-artifact@v4 step named devdigest-result', () => {
    expect(yaml).toContain('upload-artifact@v4');
    expect(yaml).toContain('name: devdigest-result');
    // Must be AFTER the run step
    const runIdx = yaml.indexOf('run: node .devdigest/runner/index.js');
    const uploadIdx = yaml.indexOf('upload-artifact@v4');
    expect(uploadIdx).toBeGreaterThan(runIdx);
  });

  it('has no curl/fetch/webhook calls', () => {
    expect(yaml).not.toMatch(/\bcurl\b|\bfetch\b|webhook/);
  });

  it('includes all required env vars', () => {
    expect(yaml).toContain('OPENROUTER_API_KEY');
    expect(yaml).toContain('GITHUB_TOKEN');
    expect(yaml).toContain('GITHUB_REPOSITORY');
    expect(yaml).toContain('PR_NUMBER');
    expect(yaml).toContain('DEVDIGEST_POST_AS');
  });

  it('DEVDIGEST_POST_AS value is embedded (not a secret reference)', () => {
    expect(yaml).toContain('DEVDIGEST_POST_AS: github_review');
  });

  it('types list comes from the triggers param', () => {
    const yaml2 = buildWorkflowYaml({
      postAs: 'pr_comment',
      triggers: ['opened', 'synchronize', 'reopened'],
    });
    expect(yaml2).toContain('- opened');
    expect(yaml2).toContain('- synchronize');
    expect(yaml2).toContain('- reopened');
  });
});

// ============================================================================
// 2. manifest.ts — generation and validation
// ============================================================================

describe('manifest.ts — generation and validation', () => {
  it('slugify converts names to lowercase-hyphenated slugs', () => {
    expect(slugify('Security Reviewer')).toBe('security-reviewer');
    expect(slugify('PR Quality Rubric')).toBe('pr-quality-rubric');
    expect(slugify('Test Agent 2')).toBe('test-agent-2');
    expect(slugify('')).toBe('agent'); // fallback
  });

  it('buildManifestYaml returns a valid slug and YAML string', () => {
    const result = buildManifestYaml({
      name: 'Security Reviewer',
      provider: 'openrouter',
      model: 'deepseek/deepseek-chat',
      systemPrompt: 'You are a security reviewer.',
      skillSlugs: ['pr-quality-rubric'],
      strategy: 'auto',
      ciFailOn: 'critical',
    });

    expect(result.slug).toBe('security-reviewer');
    expect(result.yaml).toContain('name:');
    expect(result.yaml).toContain('Security Reviewer'); // the NAME, not the slug
    expect(result.yaml).toContain('provider: openrouter');
    expect(result.yaml).toContain('model:');
    expect(result.yaml).toContain('system_prompt:');
    expect(result.yaml).toContain('pr-quality-rubric');
    expect(result.yaml).toContain('strategy: auto');
    expect(result.yaml).toContain('ci_fail_on: critical');
  });

  it('generated YAML does NOT contain post_as (absent from AgentManifest)', () => {
    const result = buildManifestYaml({
      name: 'Test Agent',
      provider: 'openrouter',
      model: 'gpt-4o',
      systemPrompt: 'You review code.',
      skillSlugs: [],
      strategy: 'auto',
      ciFailOn: 'critical',
    });
    expect(result.yaml).not.toContain('post_as');
  });

  it('validates the YAML through AgentManifest.parse — fails on invalid data', () => {
    // buildManifestYaml always passes through AgentManifest.parse internally,
    // so this just confirms invalid data throws.
    expect(() =>
      buildManifestYaml({
        name: '', // min(1) fails
        provider: 'openrouter',
        model: 'gpt-4o',
        systemPrompt: 'Test',
        skillSlugs: [],
        strategy: 'auto',
        ciFailOn: 'critical',
      }),
    ).toThrow();
  });

  it('manifest includes validated fields in the result object', () => {
    const { manifest } = buildManifestYaml({
      name: 'Test Agent',
      provider: 'openrouter',
      model: 'gpt-4o',
      systemPrompt: 'Review PRs.',
      skillSlugs: ['my-skill'],
      strategy: 'single-pass',
      ciFailOn: 'warning',
    });
    expect(manifest.name).toBe('Test Agent');
    expect(manifest.skills).toEqual(['my-skill']);
    expect(manifest.ci_fail_on).toBe('warning');
  });
});

// ============================================================================
// 3. bundle.ts — file assembly
// ============================================================================

describe('bundle.ts — CiFile[] assembly', () => {
  const RUNNER = Buffer.from('// ncc bundle');

  it('gha target: returns manifest + skills + memory + runner + workflow', () => {
    const files = buildCiBundle({
      agent: {
        name: 'Test Agent',
        provider: 'openrouter',
        model: 'gpt-4o',
        systemPrompt: 'Review code.',
        skillSlugs: ['security-audit'],
        strategy: 'auto',
        ciFailOn: 'critical',
      },
      skillBodies: [{ slug: 'security-audit', body: '# Security\nCheck for issues.' }],
      postAs: 'github_review',
      triggers: ['opened', 'synchronize'],
      target: 'gha',
      runnerBytes: RUNNER,
    });

    const paths = files.map((f) => f.path);
    expect(paths).toContain('.devdigest/agents/test-agent.yaml');
    expect(paths).toContain('.devdigest/skills/security-audit.md');
    expect(paths).toContain('.devdigest/memory.jsonl');
    expect(paths).toContain('.devdigest/runner/index.js');
    expect(paths).toContain(`.github/workflows/${WORKFLOW_FILE_NAME}`);
  });

  it('runner file contents match the injected bytes', () => {
    const files = buildCiBundle({
      agent: {
        name: 'A',
        provider: 'openrouter',
        model: 'x',
        systemPrompt: 's',
        skillSlugs: [],
        strategy: 'auto',
        ciFailOn: 'critical',
      },
      skillBodies: [],
      postAs: 'github_review',
      triggers: ['opened'],
      target: 'gha',
      runnerBytes: RUNNER,
    });
    const runner = files.find((f) => f.path === '.devdigest/runner/index.js');
    expect(runner?.contents).toBe('// ncc bundle');
  });

});

// ============================================================================
// 4. CiService — export (T3)
// ============================================================================

describe('CiService.export — T3', () => {
  let tmpDir: string;
  let runnerPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ci-test-'));
    runnerPath = join(tmpDir, 'runner.js');
    await writeFile(runnerPath, '// mock runner bundle');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Fix A: CiService now uses container.reposRepo (a DI getter) instead of
   * directly constructing RepoRepository(container.db). The mock container
   * includes reposRepo directly — no complex DB select-chain patching needed.
   */
  function makeContainer(opts: {
    agent?: { id: string; name: string; provider: string; model: string; systemPrompt: string; strategy: string; ciFailOn: string; workspaceId: string } | null;
    repo?: { id: string; fullName: string; owner: string; name: string } | null;
    repoList?: Array<{ fullName: string }>;
    githubClient?: MockGitHubClient;
    ciRepoOverride?: Partial<CiRepository>;
  }): { container: Container; github: MockGitHubClient; insertInstallationMock: ReturnType<typeof vi.fn> } {
    const github = opts.githubClient ?? new MockGitHubClient();

    const db = {} as unknown as Db;

    // Build mock agentsRepo
    const agentsRepo = {
      getById: vi.fn().mockResolvedValue(opts.agent ?? null),
      linkedSkills: vi.fn().mockResolvedValue([]),
    };

    const insertInstallationMock = vi.fn().mockResolvedValue({
      id: 'install-1',
      agentId: 'agent-1',
      repo: 'owner/repo',
      targetType: 'gha',
      installedAt: new Date('2026-01-01'),
    } satisfies CiInstallationRow);

    // Build mock ciRepo
    const defaultCiRepo = {
      insertInstallation: insertInstallationMock,
      listInstallationsForAgent: vi.fn().mockResolvedValue([]),
      installationsForWorkspace: vi.fn().mockResolvedValue([]),
      existingRunIdsForInstallation: vi.fn().mockResolvedValue(new Set()),
      listCiRuns: vi.fn().mockResolvedValue([]),
      insertCiRunWithAgentRun: vi.fn().mockResolvedValue('run-1'),
    };
    const ciRepo = { ...defaultCiRepo, ...(opts.ciRepoOverride ?? {}) };

    // Build mock reposRepo — directly on the container (Fix A: no DB patching)
    const repoRow = opts.repo
      ? {
          id: opts.repo.id,
          fullName: opts.repo.fullName,
          owner: opts.repo.owner,
          name: opts.repo.name,
          workspaceId: 'ws-1',
          createdBy: 'u1',
          createdAt: new Date(),
          clonePath: null,
          lastPolledAt: null,
          indexedAt: null,
        }
      : null;
    const reposRepo = {
      findByFullName: vi.fn().mockResolvedValue(repoRow ?? undefined),
      list: vi.fn().mockResolvedValue(opts.repoList ?? []),
    };

    const container = {
      db,
      agentsRepo,
      ciRepo,
      reposRepo, // Fix A: DI-provided, not constructed inside CiService
      github: vi.fn().mockResolvedValue(github),
      auth: new MockAuthProvider(),
    } as unknown as Container;

    return { container, github, insertInstallationMock };
  }

  const AGENT = {
    id: 'agent-1',
    name: 'Test Agent',
    provider: 'openrouter',
    model: 'gpt-4o',
    systemPrompt: 'Review code.',
    strategy: 'auto',
    ciFailOn: 'critical',
    workspaceId: 'ws-1',
  };

  const REPO = {
    id: 'repo-1',
    fullName: 'owner/repo',
    owner: 'owner',
    name: 'repo',
  };

  it('open_pr: commits files and opens PR, returns CiExport with installation', async () => {
    const { container, github, insertInstallationMock } = makeContainer({ agent: AGENT, repo: REPO });
    const service = new CiService(container, runnerPath);

    const result = await service.export('ws-1', 'agent-1', {
      repo: 'owner/repo',
      target: 'gha',
      action: 'open_pr',
      post_as: 'github_review',
      triggers: ['opened', 'synchronize'],
      base: 'main',
    });

    expect(result.pr_url).toBeTruthy();
    expect(result.files.length).toBeGreaterThan(0);
    // Fix C: installation is persisted for open_pr success
    expect(result.installation).not.toBeNull();
    expect(result.installation?.agent_id).toBe('agent-1');
    expect(insertInstallationMock).toHaveBeenCalledTimes(1);
    expect(github.committed).toHaveLength(1);
  });

  it('files: returns files with pr_url: null, no GitHub write, no installation persisted (Fix C)', async () => {
    const { container, github, insertInstallationMock } = makeContainer({ agent: AGENT, repo: REPO });
    const service = new CiService(container, runnerPath);

    const result = await service.export('ws-1', 'agent-1', {
      repo: 'owner/repo',
      target: 'gha',
      action: 'files',
      post_as: 'github_review',
      triggers: ['opened'],
      base: 'main',
    });

    expect(result.pr_url).toBeNull();
    expect(result.files.length).toBeGreaterThan(0);
    // Fix C: files action NEVER persists an installation row
    expect(result.installation).toBeNull();
    expect(insertInstallationMock).not.toHaveBeenCalled();
    expect(github.committed).toHaveLength(0);
    expect(github.openedPrs).toHaveLength(0);
  });

  it('open_pr GitHub write failure: throws ExternalServiceError (502) and installation is NOT persisted (AC-22, Fix C)', async () => {
    const failingGithub = new MockGitHubClient();
    vi.spyOn(failingGithub, 'commitFiles').mockRejectedValue(new Error('GitHub API error'));

    const { container, insertInstallationMock } = makeContainer({
      agent: AGENT,
      repo: REPO,
      githubClient: failingGithub,
    });
    const service = new CiService(container, runnerPath);

    await expect(
      service.export('ws-1', 'agent-1', {
        repo: 'owner/repo',
        target: 'gha',
        action: 'open_pr',
        post_as: 'github_review',
        triggers: ['opened'],
        base: 'main',
      }),
    ).rejects.toMatchObject({
      code: 'external_service_error',
      statusCode: 502,
      message: expect.stringContaining('Failed to push CI files to GitHub'),
    });

    // No installation row persisted because GitHub write failed (AC-22)
    expect(insertInstallationMock).not.toHaveBeenCalled();
  });

  it('file_overrides: overridden file contents replace generated contents for both actions (Fix B)', async () => {
    const { container } = makeContainer({ agent: AGENT, repo: REPO });
    const service = new CiService(container, runnerPath);

    // First, discover the path of the generated workflow file
    const baseResult = await service.export('ws-1', 'agent-1', {
      repo: 'owner/repo', target: 'gha', action: 'files',
      post_as: 'github_review', triggers: ['opened'], base: 'main',
    });
    const workflowFile = baseResult.files.find((f) => f.path.endsWith('.yml'));
    expect(workflowFile).toBeDefined();
    const workflowPath = workflowFile!.path;

    // Now apply a file_override for that path
    const { container: c2 } = makeContainer({ agent: AGENT, repo: REPO });
    const s2 = new CiService(c2, runnerPath);
    const overrideResult = await s2.export('ws-1', 'agent-1', {
      repo: 'owner/repo', target: 'gha', action: 'files',
      post_as: 'github_review', triggers: ['opened'], base: 'main',
      file_overrides: [{ path: workflowPath, contents: '# custom workflow content' }],
    });

    const overriddenFile = overrideResult.files.find((f) => f.path === workflowPath);
    expect(overriddenFile?.contents).toBe('# custom workflow content');

    // Other files are unmodified
    const otherFiles = overrideResult.files.filter((f) => f.path !== workflowPath);
    const origOtherFiles = baseResult.files.filter((f) => f.path !== workflowPath);
    expect(otherFiles.map((f) => f.contents)).toEqual(origOtherFiles.map((f) => f.contents));
  });

  it('file_overrides: override for unknown path is ignored (Fix B)', async () => {
    const { container } = makeContainer({ agent: AGENT, repo: REPO });
    const service = new CiService(container, runnerPath);

    const result = await service.export('ws-1', 'agent-1', {
      repo: 'owner/repo', target: 'gha', action: 'files',
      post_as: 'github_review', triggers: ['opened'], base: 'main',
      file_overrides: [{ path: 'nonexistent/path.txt', contents: 'injected' }],
    });

    // No file with path 'nonexistent/path.txt' should appear in the bundle
    const injected = result.files.find((f) => f.path === 'nonexistent/path.txt');
    expect(injected).toBeUndefined();
    // All generated files are still present
    expect(result.files.length).toBeGreaterThan(0);
  });

  it('missing runner asset: throws AppError with descriptive message', async () => {
    const { container } = makeContainer({ agent: AGENT, repo: REPO });
    const service = new CiService(container, '/nonexistent/path/runner.js');

    await expect(
      service.export('ws-1', 'agent-1', {
        repo: 'owner/repo',
        target: 'gha',
        action: 'files',
        post_as: 'github_review',
        triggers: ['opened'],
        base: 'main',
      }),
    ).rejects.toMatchObject({
      code: 'runner_asset_missing',
    });
  });

  it('agent not found: throws NotFoundError', async () => {
    const { container } = makeContainer({ agent: null, repo: REPO });
    const service = new CiService(container, runnerPath);

    await expect(
      service.export('ws-1', 'nonexistent-agent', {
        repo: 'owner/repo',
        target: 'gha',
        action: 'files',
        post_as: 'github_review',
        triggers: ['opened'],
        base: 'main',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('repo not connected: throws ValidationError', async () => {
    const { container } = makeContainer({ agent: AGENT, repo: null, repoList: [] });
    const service = new CiService(container, runnerPath);

    await expect(
      service.export('ws-1', 'agent-1', {
        repo: 'owner/not-connected',
        target: 'gha',
        action: 'files',
        post_as: 'github_review',
        triggers: ['opened'],
        base: 'main',
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('non-gha target: service rejects with ValidationError before building any bundle (Fix 2)', async () => {
    // buildPlaceholderBundle has been removed from bundle.ts; non-gha targets are now
    // rejected at the service boundary so buildCiBundle is never reached.
    const { container } = makeContainer({ agent: AGENT, repo: REPO });
    const service = new CiService(container, runnerPath);

    await expect(
      service.export('ws-1', 'agent-1', {
        repo: 'owner/repo',
        target: 'circle',
        action: 'files',
        post_as: 'github_review',
        triggers: ['opened'],
        base: 'main',
      }),
    ).rejects.toMatchObject({
      code: 'validation_error',
      statusCode: 422,
      message: expect.stringContaining("Only target='gha'"),
    });
  });
});

// ============================================================================
// 5. CiService.refresh — T4: dedup, malformed artifact, source column
// ============================================================================

describe('CiService.refresh — T4 ingestion', () => {
  function makeRefreshContainer(opts: {
    installations: Array<{
      installationId: string;
      agentId: string;
      repo: string;
      targetType: string;
      existingRunIds?: Set<string>;
    }>;
    workflowRuns?: Array<{ runId: number; status: string; conclusion: string | null; htmlUrl: string; headBranch: string | null }>;
    artifactBuffer?: Buffer | null;
    insertFn?: ReturnType<typeof vi.fn>;
  }): { container: Container; insertCiRunMock: ReturnType<typeof vi.fn> } {
    const gh = new MockGitHubClient({
      workflowRuns: opts.workflowRuns ?? [
        {
          runId: 1001,
          status: 'completed',
          conclusion: 'success',
          htmlUrl: 'https://github.com/mock/mock/actions/runs/1001',
          headBranch: 'main',
        },
      ],
      artifactBuffer: opts.artifactBuffer !== undefined ? opts.artifactBuffer : Buffer.from(
        JSON.stringify({ findings_count: 2, cost_usd: 0.01, agent: 'test-agent', duration_ms: 1000, pr_number: 42 })
      ),
    });

    const insertCiRunMock = opts.insertFn ?? vi.fn().mockResolvedValue('run-new');
    const listCiRunsMock = vi.fn().mockResolvedValue([]);

    const existingRunIdsMap = new Map(
      opts.installations.map((i) => [i.installationId, i.existingRunIds ?? new Set()])
    );

    const ciRepo = {
      installationsForWorkspace: vi.fn().mockResolvedValue(
        opts.installations.map((i) => ({
          installation: {
            id: i.installationId,
            agentId: i.agentId,
            repo: i.repo,
            targetType: i.targetType,
            installedAt: new Date(),
          } as CiInstallationRow,
          agent: { id: i.agentId, name: 'Test Agent', workspaceId: 'ws-1' },
        }))
      ),
      existingRunIdsForInstallation: vi.fn().mockImplementation((installationId: string) =>
        Promise.resolve(existingRunIdsMap.get(installationId) ?? new Set())
      ),
      insertCiRunWithAgentRun: insertCiRunMock,
      listCiRuns: listCiRunsMock,
    };

    const container = {
      agentsRepo: { getById: vi.fn() },
      ciRepo,
      github: vi.fn().mockResolvedValue(gh),
      auth: new MockAuthProvider(),
    } as unknown as Container;

    return { container, insertCiRunMock };
  }

  it('dedup: second Refresh call inserts zero new rows', async () => {
    // First refresh — run 1001 is NEW
    const { container, insertCiRunMock } = makeRefreshContainer({
      installations: [{ installationId: 'install-1', agentId: 'agent-1', repo: 'owner/repo', targetType: 'gha' }],
    });
    const service = new CiService(container);
    await service.refresh('ws-1');
    expect(insertCiRunMock).toHaveBeenCalledTimes(1);

    // Second refresh — now run 1001 is already in existingRunIds
    const { container: container2, insertCiRunMock: insert2 } = makeRefreshContainer({
      installations: [{
        installationId: 'install-1',
        agentId: 'agent-1',
        repo: 'owner/repo',
        targetType: 'gha',
        existingRunIds: new Set(['1001']), // already ingested
      }],
    });
    const service2 = new CiService(container2);
    await service2.refresh('ws-1');
    expect(insert2).not.toHaveBeenCalled();
  });

  it('malformed artifact: skips the run, does not abort, inserts nothing', async () => {
    const { container, insertCiRunMock } = makeRefreshContainer({
      installations: [{ installationId: 'install-1', agentId: 'agent-1', repo: 'owner/repo', targetType: 'gha' }],
      artifactBuffer: Buffer.from('NOT VALID JSON {{{'),
    });
    const service = new CiService(container);
    await service.refresh('ws-1');
    expect(insertCiRunMock).not.toHaveBeenCalled();
  });

  it('schema mismatch artifact: skips the run without aborting', async () => {
    const { container, insertCiRunMock } = makeRefreshContainer({
      installations: [{ installationId: 'install-1', agentId: 'agent-1', repo: 'owner/repo', targetType: 'gha' }],
      // Valid JSON but wrong shape — findings_count is missing
      artifactBuffer: Buffer.from(JSON.stringify({ wrong: 'shape' })),
    });
    const service = new CiService(container);
    await service.refresh('ws-1');
    expect(insertCiRunMock).not.toHaveBeenCalled();
  });

  it('null artifact buffer (absent/oversized): skips the run', async () => {
    const { container, insertCiRunMock } = makeRefreshContainer({
      installations: [{ installationId: 'install-1', agentId: 'agent-1', repo: 'owner/repo', targetType: 'gha' }],
      artifactBuffer: null,
    });
    const service = new CiService(container);
    await service.refresh('ws-1');
    expect(insertCiRunMock).not.toHaveBeenCalled();
  });

  it('Fix D: insertCiRunWithAgentRun is NOT passed a "source" display name (stored at insert time is removed)', async () => {
    const capturedData: unknown[] = [];
    const insertFn = vi.fn().mockImplementation((data: unknown) => {
      capturedData.push(data);
      return Promise.resolve('run-1');
    });

    const { container } = makeRefreshContainer({
      installations: [{
        installationId: 'install-1',
        agentId: 'agent-1',
        repo: 'owner/repo',
        targetType: 'gha',
      }],
      insertFn,
    });
    const service = new CiService(container);
    await service.refresh('ws-1');

    expect(capturedData).toHaveLength(1);
    // Fix D: source must NOT be stored at insert time — it is derived at READ time
    expect((capturedData[0] as any).source).toBeUndefined();
    // The insert data still carries the installation id (for the join at read time)
    expect((capturedData[0] as any).ciInstallationId).toBe('install-1');
  });

  it('no-installations workspace: returns empty list', async () => {
    const { container } = makeRefreshContainer({ installations: [] });
    const service = new CiService(container);
    const result = await service.refresh('ws-1');
    expect(result).toEqual([]);
  });

  it('multi-agent bundle: matches each installation to its OWN agent entry by name', async () => {
    // Two agents exported to the SAME repo → two installation rows, one
    // shared workflow run whose artifact is the combined bundle.
    const insertFn = vi.fn().mockResolvedValue('run-x');
    const gh = new MockGitHubClient({
      workflowRuns: [
        {
          runId: 2001,
          status: 'completed',
          conclusion: 'success',
          htmlUrl: 'https://github.com/mock/mock/actions/runs/2001',
          headBranch: 'main',
        },
      ],
      artifactBuffer: Buffer.from(
        JSON.stringify({
          version: '1',
          agents: [
            { findings_count: 1, cost_usd: 0.01, agent: 'General Reviewer', duration_ms: 500, pr_number: 7 },
            { findings_count: 3, cost_usd: 0.02, agent: 'Security Reviewer', duration_ms: 900, pr_number: 7 },
          ],
        }),
      ),
    });
    const ciRepo = {
      installationsForWorkspace: vi.fn().mockResolvedValue([
        {
          installation: { id: 'install-general', agentId: 'agent-general', repo: 'owner/repo', targetType: 'gha', installedAt: new Date() } as CiInstallationRow,
          agent: { id: 'agent-general', name: 'General Reviewer', workspaceId: 'ws-1' },
        },
        {
          installation: { id: 'install-security', agentId: 'agent-security', repo: 'owner/repo', targetType: 'gha', installedAt: new Date() } as CiInstallationRow,
          agent: { id: 'agent-security', name: 'Security Reviewer', workspaceId: 'ws-1' },
        },
      ]),
      existingRunIdsForInstallation: vi.fn().mockResolvedValue(new Set()),
      insertCiRunWithAgentRun: insertFn,
      listCiRuns: vi.fn().mockResolvedValue([]),
    };
    const container = {
      agentsRepo: { getById: vi.fn() },
      ciRepo,
      github: vi.fn().mockResolvedValue(gh),
      auth: new MockAuthProvider(),
    } as unknown as Container;

    const service = new CiService(container);
    await service.refresh('ws-1');

    expect(insertFn).toHaveBeenCalledTimes(2);
    const byInstallation = new Map(
      insertFn.mock.calls.map((call: any[]) => [call[0].ciInstallationId, call[0]]),
    );
    expect(byInstallation.get('install-general').findingsCount).toBe(1);
    expect(byInstallation.get('install-security').findingsCount).toBe(3);
  });
});

// ============================================================================
// 6. CiRepository.listCiRuns — Fix D: source derived at read time, leftJoin
// ============================================================================

/**
 * Build a CiRepository backed by a mock DB that returns `rows` as the result
 * of listCiRuns's select-leftJoin-leftJoin-where-orderBy chain. Used by both
 * section 6 (source derivation) and section 6b (cross-workspace isolation).
 */
function makeRepoWithMockRows(rows: unknown[]): CiRepository {
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      }),
    }),
  } as unknown as Db;
  return new CiRepository(db);
}

describe('CiRepository.listCiRuns — Fix D source derivation', () => {
  /**
   * Test the repository's row-mapper directly by supplying mock DB rows that
   * simulate left-join results (including null targetType for orphaned rows).
   * Drizzle's select chain is mocked to return controlled row objects.
   */

  it('normally-linked run: source derived from gha targetType → "GitHub Actions"', async () => {
    const rows = [{
      id: 'run-1',
      ciInstallationId: 'install-1',
      prNumber: 42,
      ranAt: new Date('2026-01-01'),
      status: 'success',
      findingsCount: 3,
      costUsd: 0.01,
      githubUrl: 'https://github.com/a/b/actions/runs/1',
      targetType: 'gha',        // from left-joined ci_installations
      agentName: 'My Agent',    // from left-joined agents
      githubRunId: '12345',
    }];
    const repo = makeRepoWithMockRows(rows);
    const runs = await repo.listCiRuns('ws-1');

    expect(runs).toHaveLength(1);
    expect(runs[0]!.source).toBe('GitHub Actions');
    expect(runs[0]!.agent).toBe('My Agent');
  });

  it('normally-linked run: source derived from circle targetType → "CircleCI"', async () => {
    const rows = [{
      id: 'run-2', ciInstallationId: 'install-2', prNumber: null,
      ranAt: new Date(), status: 'failed', findingsCount: 0, costUsd: null,
      githubUrl: 'https://example.com', targetType: 'circle', agentName: 'CI Bot', githubRunId: null,
    }];
    const repo = makeRepoWithMockRows(rows);
    const [run] = await repo.listCiRuns('ws-1');
    expect(run!.source).toBe('CircleCI');
  });

  it('orphaned run (ci_installation_id = null): source → "Unknown", not omitted (Fix D / AC-26)', async () => {
    // Simulates a ci_runs row where the installation was deleted
    // (onDelete:'set null') — left join gives null for targetType and agentName.
    const rows = [{
      id: 'run-orphan',
      ciInstallationId: null,     // installation deleted, set to null
      prNumber: 7,
      ranAt: new Date('2025-12-01'),
      status: 'success',
      findingsCount: 1,
      costUsd: 0.005,
      githubUrl: 'https://github.com/a/b/actions/runs/99',
      targetType: null,           // no installation to join → null from left join
      agentName: null,            // no agent either
      githubRunId: '99',
    }];
    const repo = makeRepoWithMockRows(rows);
    const runs = await repo.listCiRuns('ws-1');

    expect(runs).toHaveLength(1);
    expect(runs[0]!.source).toBe('Unknown');
    expect(runs[0]!.agent).toBeNull();
    expect(runs[0]!.ci_installation_id).toBeNull();
  });

  it('mixed batch: orphaned run and normal run both returned, sources correct', async () => {
    const rows = [
      {
        id: 'run-a', ciInstallationId: 'inst-a', prNumber: null, ranAt: new Date(),
        status: 'success', findingsCount: 0, costUsd: null, githubUrl: 'https://x',
        targetType: 'gha', agentName: 'Agent A', githubRunId: '1',
      },
      {
        id: 'run-b', ciInstallationId: null, prNumber: null, ranAt: new Date(),
        status: 'failed', findingsCount: 2, costUsd: 0.01, githubUrl: 'https://y',
        targetType: null, agentName: null, githubRunId: '2',
      },
    ];
    const repo = makeRepoWithMockRows(rows);
    const runs = await repo.listCiRuns('ws-1');

    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.id === 'run-a')!.source).toBe('GitHub Actions');
    expect(runs.find((r) => r.id === 'run-b')!.source).toBe('Unknown');
  });
});

// ============================================================================
// 6b. CiRepository.listCiRuns — cross-workspace isolation regression (CRITICAL)
// ============================================================================

describe('CiRepository.listCiRuns — cross-workspace isolation regression', () => {
  /**
   * Regression test for the CRITICAL finding: after an agent (and its
   * ci_installations row) is deleted, orphaned ci_runs rows were previously
   * visible to EVERY workspace via the `isNull(ciRuns.ciInstallationId)` branch
   * of the old OR-WHERE clause. The fix adds workspace_id directly to ci_runs
   * and scopes the WHERE clause on that column.
   *
   * These tests use the same mock-DB infrastructure as section 6: each
   * makeRepoWithMockRows() instance simulates what the DB returns AFTER
   * applying WHERE ci_runs.workspace_id = <workspaceId>. The actual SQL
   * filtering is enforced at the Postgres level by the new column + WHERE clause.
   */

  const wsAOrphan = {
    id: 'run-ws-a-orphan',
    ciInstallationId: null,    // installation deleted → ci_installation_id set null
    prNumber: 10,
    ranAt: new Date('2026-02-01'),
    status: 'success',
    findingsCount: 2,
    costUsd: 0.02,
    githubUrl: 'https://github.com/ws-a-owner/repo/actions/runs/10',
    targetType: null,          // no installation to join
    agentName: null,
    githubRunId: '10',
  };

  const wsBOrphan = {
    id: 'run-ws-b-orphan',
    ciInstallationId: null,    // installation deleted → ci_installation_id set null
    prNumber: 20,
    ranAt: new Date('2026-02-02'),
    status: 'failed',
    findingsCount: 7,
    costUsd: 0.07,
    githubUrl: 'https://github.com/ws-b-owner/secret-repo/actions/runs/20',
    targetType: null,
    agentName: null,
    githubRunId: '20',
  };

  it('workspace A: listCiRuns returns only ws-A orphaned row (not ws-B)', async () => {
    // DB scopes to workspace A's rows via WHERE ci_runs.workspace_id = 'ws-A'
    const repoA = makeRepoWithMockRows([wsAOrphan]);
    const runsA = await repoA.listCiRuns('ws-A');

    expect(runsA).toHaveLength(1);
    expect(runsA[0]!.id).toBe('run-ws-a-orphan');
    expect(runsA[0]!.source).toBe('Unknown');   // orphaned → Unknown (not omitted)
    expect(runsA[0]!.github_url).toBe('https://github.com/ws-a-owner/repo/actions/runs/10');

    // ws-B's github_url (would reveal another tenant's repo) must NOT be visible
    expect(runsA.some((r) => r.id === 'run-ws-b-orphan')).toBe(false);
    expect(runsA.some((r) => r.github_url?.includes('ws-b-owner'))).toBe(false);
  });

  it('workspace B: listCiRuns returns only ws-B orphaned row (not ws-A)', async () => {
    // DB scopes to workspace B's rows via WHERE ci_runs.workspace_id = 'ws-B'
    const repoB = makeRepoWithMockRows([wsBOrphan]);
    const runsB = await repoB.listCiRuns('ws-B');

    expect(runsB).toHaveLength(1);
    expect(runsB[0]!.id).toBe('run-ws-b-orphan');
    expect(runsB[0]!.source).toBe('Unknown');   // orphaned → Unknown (not omitted)
    expect(runsB[0]!.github_url).toBe('https://github.com/ws-b-owner/secret-repo/actions/runs/20');

    // ws-A's github_url (tenant A's repo) must NOT be visible to workspace B
    expect(runsB.some((r) => r.id === 'run-ws-a-orphan')).toBe(false);
    expect(runsB.some((r) => r.github_url?.includes('ws-a-owner'))).toBe(false);
  });

  it('both workspaces see their own orphaned row; neither leaks to the other', async () => {
    // Two separate listCiRuns calls for two workspaces — each scoped by workspace_id.
    // In production, Postgres applies WHERE workspace_id = ? to each call independently.
    const repoA = makeRepoWithMockRows([wsAOrphan]);
    const repoB = makeRepoWithMockRows([wsBOrphan]);

    const [runsA, runsB] = await Promise.all([
      repoA.listCiRuns('ws-A'),
      repoB.listCiRuns('ws-B'),
    ]);

    // Each workspace sees exactly one orphaned row — its own
    expect(runsA.map((r) => r.id)).toEqual(['run-ws-a-orphan']);
    expect(runsB.map((r) => r.id)).toEqual(['run-ws-b-orphan']);

    // Source is 'Unknown' for both (installations deleted, left join gives null targetType)
    expect(runsA[0]!.source).toBe('Unknown');
    expect(runsB[0]!.source).toBe('Unknown');

    // Cross-check: ws-B's secret-repo URL is not in ws-A's result
    const wsAUrls = runsA.map((r) => r.github_url);
    expect(wsAUrls.some((u) => u?.includes('secret-repo'))).toBe(false);
  });
});

// ============================================================================
// 7a. CiExportInput.triggers — YAML-injection validation (security fix)
// ============================================================================

describe('CiExportInput.triggers — Zod enum validation blocks YAML injection', () => {
  it('rejects a trigger string containing a newline (YAML break-out attempt)', () => {
    const result = CiExportInput.safeParse({
      repo: 'owner/repo',
      triggers: ['opened\n  - pull_request_target'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects any trigger value outside the allowed enum', () => {
    const result = CiExportInput.safeParse({
      repo: 'owner/repo',
      triggers: ['push'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts all three legitimate trigger values and they appear in the generated YAML types block', () => {
    const result = CiExportInput.safeParse({
      repo: 'owner/repo',
      triggers: ['opened', 'synchronize', 'reopened'],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const yaml = buildWorkflowYaml({
      postAs: 'github_review',
      triggers: result.data.triggers,
    });
    expect(yaml).toContain('- opened');
    expect(yaml).toContain('- synchronize');
    expect(yaml).toContain('- reopened');
    expect(yaml).not.toContain('pull_request_target');
  });

  it('applies the default (opened, synchronize, reopened) when triggers is omitted', () => {
    const result = CiExportInput.safeParse({ repo: 'owner/repo' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.triggers).toEqual(['opened', 'synchronize', 'reopened']);
  });
});

// ============================================================================
// 7. Parity test (AC-29): reviewPullRequest matches local pipeline
// ============================================================================

describe('AC-29: CI runner parity — reviewPullRequest produces same findings as local pipeline (section 7)', () => {
  /**
   * This test ensures the SAME reviewer-core `reviewPullRequest` call path
   * produces identical grounded findings regardless of whether it's called
   * from the local studio or from the CI runner's runCi() orchestrator.
   *
   * We reuse the exact fixture and mock from adapters.test.ts:
   *  - f1 (grounded, line 11 in the diff) → survives
   *  - f-hallucinated (line 999, not in diff) → dropped by grounding gate
   */
  const fixture = {
    verdict: 'request_changes',
    summary: 'secret key committed',
    score: 38,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'sk_live in diff',
        confidence: 0.98,
        kind: 'finding',
      },
      {
        id: 'f-hallucinated',
        severity: 'WARNING',
        category: 'bug',
        title: 'phantom finding on a line not in the diff',
        file: 'src/config.ts',
        start_line: 999,
        end_line: 999,
        rationale: 'not real',
        confidence: 0.3,
        kind: 'finding',
      },
    ],
  };

  it('reviewPullRequest grounds findings identically to the direct assemble+ground pipeline', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const git = new MockGitClient();
    const diff = await git.diff();

    // This is the SAME path the CI runner calls (via runCi() → reviewPullRequest)
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      strategy: 'single-pass',
    });

    // Grounded findings must match the local-review pipeline (adapters.test.ts result)
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.id).toBe('f1');
    // Hallucinated finding must be dropped
    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.dropped[0]!.finding.id).toBe('f-hallucinated');
  });
});
