/**
 * CI service — export + refresh (ingestion) orchestration.
 *
 * T3: export()  — generate the CI bundle, commit files / open PR on GitHub,
 *                 persist ci_installation, return CiExport.
 * T4: refresh() — pull completed GHA workflow runs, download+parse artifacts,
 *                 insert new ci_runs + agent_runs rows (deduped, transactional).
 *
 * Onion layer: Application (service). No route HTTP logic, no raw SQL. All DB
 * access goes through CiRepository; all GitHub calls through the GitHubClient
 * port on the container.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError, AppError, ExternalServiceError } from '../../platform/errors.js';
import type {
  CiExportInput,
  CiExport,
  CiInstallation,
  CiRun,
  CiResultArtifact,
} from '@devdigest/shared';
import {
  CiResultArtifact as CiResultArtifactSchema,
  CiResultBundle as CiResultBundleSchema,
} from '@devdigest/shared';
import { CiRepository } from './repository.js';
import { buildCiBundle, skillSlugFromName } from './bundle.js';
import { WORKFLOW_FILE_NAME } from './workflow.js';

const _thisFile = fileURLToPath(import.meta.url);
export const DEFAULT_RUNNER_PATH = join(dirname(_thisFile), 'assets', 'runner', 'index.js');

/** Max size for a single file_overrides.contents value (AC-5 edit-before-push).
 *  Guards against a workspace member pasting/generating multi-MB content into
 *  a workflow file override — no legitimate generated CI file approaches this. */
const MAX_FILE_OVERRIDE_BYTES = 100_000;

/** Parse "owner/name" → RepoRef. Throws ValidationError on bad format. */
function parseRepoRef(fullName: string): { owner: string; name: string } {
  const [owner, name] = fullName.split('/');
  if (!owner || !name) {
    throw new ValidationError(`Invalid repo full_name: "${fullName}" — expected "owner/name"`);
  }
  return { owner, name };
}

export class CiService {
  private ciRepo: CiRepository;
  private reposRepo: Container['reposRepo'];

  constructor(
    private container: Container,
    /** Overrideable for tests — defaults to the built-in runner asset. */
    private runnerPath: string = DEFAULT_RUNNER_PATH,
  ) {
    this.ciRepo = container.ciRepo;
    this.reposRepo = container.reposRepo; // Fix A: use container getter, not new RepoRepository(db)
  }

  // ---------------------------------------------------------------------------
  // T3 — Export
  // ---------------------------------------------------------------------------

  async export(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiExport> {
    // 1. Resolve agent (workspace-scoped)
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // 2. Validate repo ownership — must belong to this workspace
    const repoRow = await this.reposRepo.findByFullName(workspaceId, input.repo);
    if (!repoRow) {
      // Check that the workspace has ANY connected repos, to give a better error.
      const allRepos = await this.reposRepo.list(workspaceId);
      if (allRepos.length === 0) {
        throw new ValidationError(
          'No repositories connected to this workspace. Add a repo before exporting to CI.',
        );
      }
      throw new ValidationError(
        `Repository "${input.repo}" is not connected to this workspace. ` +
          `Add it via Settings → Repositories first.`,
      );
    }
    const repoRef = parseRepoRef(input.repo);

    // 3. Read the runner asset (hard-fail if missing)
    let runnerBytes: Buffer;
    try {
      runnerBytes = await readFile(this.runnerPath);
    } catch {
      throw new AppError(
        'runner_asset_missing',
        'CI runner asset missing — run `npm run build` in agent-runner ' +
          'and copy dist/index.js to server/src/modules/ci/assets/runner/index.js',
        500,
      );
    }

    // 4. Resolve linked skills for this agent
    const linkedSkills = await this.container.agentsRepo.linkedSkills(agentId);
    const skillBodies = linkedSkills
      .filter((ls) => ls.skill.enabled)
      .map((ls) => ({
        slug: skillSlugFromName(ls.skill.name),
        body: ls.skill.body,
      }));
    const skillSlugs = skillBodies.map((s) => s.slug);

    // 5. Build the CI bundle (pure, no I/O)
    // Guard: only GitHub Actions is currently implemented. Non-gha requests are
    // rejected here so the client-side UI restriction has a server-side backstop.
    if (input.target !== 'gha') {
      throw new ValidationError(
        "Only target='gha' (GitHub Actions) is currently supported",
      );
    }
    const rawFiles = buildCiBundle({
      agent: {
        name: agent.name,
        provider: agent.provider as 'openai' | 'anthropic' | 'openrouter',
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        skillSlugs,
        strategy: agent.strategy as 'auto' | 'single-pass' | 'map-reduce',
        ciFailOn: agent.ciFailOn as 'never' | 'critical' | 'warning' | 'any',
      },
      skillBodies,
      postAs: input.post_as,
      triggers: input.triggers,
      target: input.target,
      runnerBytes,
    });

    // 6. Apply caller-supplied file_overrides (AC-5 — edit-before-push / Preview edits).
    //    For each override, replace the matching generated file's contents; overrides for
    //    unknown paths are silently ignored (we never inject arbitrary new files).
    const fileOverrides = input.file_overrides ?? [];
    for (const ov of fileOverrides) {
      if (Buffer.byteLength(ov.contents, 'utf8') > MAX_FILE_OVERRIDE_BYTES) {
        throw new ValidationError(
          `file_overrides entry for "${ov.path}" exceeds the ${MAX_FILE_OVERRIDE_BYTES}-byte limit`,
        );
      }
    }
    const files = fileOverrides.length > 0
      ? rawFiles.map((f) => {
          const ov = fileOverrides.find((o) => o.path === f.path);
          return ov ? { ...f, contents: ov.contents } : f;
        })
      : rawFiles;

    // 7. GitHub write (only for open_pr) AND installation persistence.
    //    Fix C: only persist a ci_installations row when action==='open_pr' AND
    //    the GitHub write actually succeeds — never for action==='files' (Preview),
    //    and never if commitFiles or PR resolution throws (AC-22).
    let pr_url: string | null = null;
    let installation: CiInstallation | null = null;

    if (input.action === 'open_pr') {
      const gh = await this.container.github();

      // Map CiFile[] to CommitFile[] (same shape, different type names)
      const commitFiles = files.map((f) => ({ path: f.path, contents: f.contents }));

      try {
        await gh.commitFiles(repoRef, {
          branch: 'devdigest/ci',
          base: input.base,
          message: 'chore: add DevDigest CI review',
          files: commitFiles,
        });

        // Re-use an existing open PR if one is already up, else open a new one.
        const existing = await gh.findOpenPr(repoRef, 'devdigest/ci');
        if (existing) {
          pr_url = existing.url;
        } else {
          const opened = await gh.openPullRequest(repoRef, {
            title: 'Add DevDigest CI review',
            head: 'devdigest/ci',
            base: input.base,
            body:
              '## DevDigest CI Integration\n\n' +
              'This PR adds an automated code-review workflow powered by [DevDigest](https://devdigest.ai).\n\n' +
              '- Agent: **' + agent.name + '**\n' +
              '- Trigger: pull_request events\n\n' +
              '_Generated by DevDigest Export to CI_',
          });
          pr_url = opened.url;
        }
      } catch (err) {
        throw new ExternalServiceError(
          'Failed to push CI files to GitHub: ' +
            (err instanceof Error ? err.message : String(err)),
          { cause: err },
        );
      }

      // Persist the installation row AFTER all GitHub writes succeed (AC-22: GitHub
      // write failure → persist nothing).
      const installationRow = await this.ciRepo.insertInstallation({
        agentId,
        repo: input.repo,
        targetType: input.target,
      });
      installation = CiRepository.toInstallationDto(installationRow);
    }

    return { installation, files, pr_url };
  }

  // ---------------------------------------------------------------------------
  // T3 — List installations for an agent
  // ---------------------------------------------------------------------------

  async listInstallations(workspaceId: string, agentId: string): Promise<CiInstallation[]> {
    // Verify the agent belongs to this workspace
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const rows = await this.ciRepo.listInstallationsForAgent(agentId);
    return rows.map(CiRepository.toInstallationDto);
  }

  // ---------------------------------------------------------------------------
  // T4 — List CI runs for a workspace
  // ---------------------------------------------------------------------------

  async listCiRuns(workspaceId: string): Promise<CiRun[]> {
    return this.ciRepo.listCiRuns(workspaceId);
  }

  // ---------------------------------------------------------------------------
  // T4 — Refresh (pull-based ingestion)
  // ---------------------------------------------------------------------------

  async refresh(workspaceId: string): Promise<CiRun[]> {
    const gh = await this.container.github();
    const installations = await this.ciRepo.installationsForWorkspace(workspaceId);

    for (const { installation, agent } of installations) {
      const repoRef = parseRepoRef(installation.repo);

      // Pre-check: which github_run_ids are already in the DB for this installation?
      const existingRunIds = await this.ciRepo.existingRunIdsForInstallation(installation.id);

      // Pull completed workflow runs from GitHub
      let workflowRuns;
      try {
        workflowRuns = await gh.listWorkflowRuns(repoRef, WORKFLOW_FILE_NAME);
      } catch {
        // Network / auth failure for one repo — skip, don't abort the whole batch
        continue;
      }

      // Only process completed runs not already ingested
      const newRuns = workflowRuns.filter(
        (run) => run.status === 'completed' && !existingRunIds.has(String(run.runId)),
      );

      for (const run of newRuns) {
        // Download the artifact (null = missing / oversized / transport error → skip)
        const buffer = await gh.downloadRunArtifact(repoRef, run.runId, 'devdigest-result');
        if (buffer === null) continue;

        // Parse the artifact JSON
        let json: unknown;
        try {
          json = JSON.parse(buffer.toString('utf8'));
        } catch {
          // Malformed JSON — skip this run, continue the batch
          continue;
        }

        // Accept either the multi-agent bundle shape ({ agents: [...] }) or a
        // bare single-agent object (older runner versions already installed
        // in a target repo, back-compat) as an equivalent one-element bundle.
        let bundleAgents: CiResultArtifact[];
        const asBundle = CiResultBundleSchema.safeParse(json);
        if (asBundle.success) {
          bundleAgents = asBundle.data.agents;
        } else {
          const asSingle = CiResultArtifactSchema.safeParse(json);
          if (!asSingle.success) continue; // Schema mismatch — skip this run
          bundleAgents = [asSingle.data];
        }

        // Which per-agent entry belongs to THIS installation's agent? A
        // one-element bundle always matches (the common case — one agent
        // exported to this repo); a genuine multi-agent bundle is
        // disambiguated by the manifest's declared name.
        const artifact =
          bundleAgents.length === 1
            ? bundleAgents[0]
            : bundleAgents.find((a) => a.agent === agent.name);
        if (!artifact) continue; // this installation's agent wasn't in the run's bundle

        // Insert ci_runs + agent_runs in one transaction (ALWAYS INSERT, never upsert).
        // Fix D: source is no longer stored at insert time — derived from
        // ci_installations.target_type at READ time in CiRepository.listCiRuns.
        try {
          await this.ciRepo.insertCiRunWithAgentRun({
            ciInstallationId: installation.id,
            workspaceId: agent.workspaceId,
            agentId: agent.id,
            prNumber: artifact.pr_number ?? null,
            status: run.conclusion,
            findingsCount: artifact.findings_count,
            costUsd: artifact.cost_usd,
            githubUrl: run.htmlUrl,
            githubRunId: String(run.runId),
            durationMs: artifact.duration_ms ?? null,
          });
        } catch {
          // Unique constraint violation (race with a parallel refresh) — skip silently
          continue;
        }
      }
    }

    return this.ciRepo.listCiRuns(workspaceId);
  }
}
