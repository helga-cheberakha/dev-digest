import { stat } from 'node:fs/promises';
import { and, asc, eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import type {
  Agent,
  AgentSkillLink,
  AgentVersion,
  CiFailOn,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { repos } from '../../db/schema.js';
import { ValidationError } from '../../platform/errors.js';
import { guardPath } from '../project-context/path-guard.js';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toAgentDto);
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toAgentDto(row) : undefined;
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({ agent_id: agentId, skill_id: l.skill.id, order: l.order }));
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.setSkills(agentId, skillIds);
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }

  // ---- document attachment (AC-5, AC-8, AC-9) ------------------------------

  /**
   * Ordered document paths attached to an agent (workspace-scoped).
   * Returns undefined when the agent does not exist in this workspace.
   */
  async getDocuments(workspaceId: string, agentId: string): Promise<string[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    return this.repo.documentsForAgent(agentId);
  }

  /**
   * Replace the agent's attached document paths. Each path is validated via
   * the path-guard before persisting. If any path is invalid the entire request
   * is rejected and nothing is persisted (AC-8).
   *
   * Returns the persisted ordered paths, or undefined when the agent does not
   * exist in this workspace.
   */
  async setDocuments(
    workspaceId: string,
    agentId: string,
    paths: string[],
    repoId?: string,
  ): Promise<string[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;

    const cloneRoot = await this.resolveCloneRoot(workspaceId, repoId);

    // Validate ALL paths first — reject the whole request if any fail (AC-8).
    // After normalization, dedup post-normalization collisions (first wins).
    const failures: string[] = [];
    const seen = new Set<string>();
    const normalizedPaths: string[] = [];
    for (const path of paths) {
      const result = await guardPath(path, cloneRoot);
      if (!result.ok) {
        failures.push(`"${path}": ${result.reason}`);
      } else if (!seen.has(result.path)) {
        seen.add(result.path);
        normalizedPaths.push(result.path);
      }
    }

    if (failures.length > 0) {
      throw new ValidationError('Invalid document paths', failures);
    }

    await this.repo.setDocuments(agentId, normalizedPaths);
    return this.repo.documentsForAgent(agentId);
  }

  /**
   * Resolve the absolute clone root for the workspace's repo.
   *
   * When `repoId` is provided, resolves exactly that repo (workspace-scoped).
   * When absent, uses a deterministic fallback: ORDER BY created_at and return
   * the first repo whose clone directory exists on disk. If no clone exists,
   * falls back to the oldest repo. Returns '' when no repo is configured.
   */
  private async resolveCloneRoot(workspaceId: string, repoId?: string): Promise<string> {
    if (repoId) {
      const [repo] = await this.container.db
        .select({ owner: repos.owner, name: repos.name })
        .from(repos)
        .where(and(eq(repos.workspaceId, workspaceId), eq(repos.id, repoId)));
      if (!repo) return '';
      return this.container.git.clonePathFor({ owner: repo.owner, name: repo.name });
    }

    // Deterministic fallback: prefer the oldest repo that has a clone on disk.
    const rows = await this.container.db
      .select({ owner: repos.owner, name: repos.name })
      .from(repos)
      .where(eq(repos.workspaceId, workspaceId))
      .orderBy(asc(repos.createdAt));

    if (rows.length === 0) return '';

    for (const row of rows) {
      const clonePath = this.container.git.clonePathFor({ owner: row.owner, name: row.name });
      try {
        await stat(clonePath);
        return clonePath;
      } catch {
        // clone not present on disk — try the next repo
      }
    }

    // No clone found — fall back to the oldest repo's path (guardPath will handle it).
    return this.container.git.clonePathFor({ owner: rows[0]!.owner, name: rows[0]!.name });
  }
}
