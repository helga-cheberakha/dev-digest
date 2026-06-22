import type { Convention, ExtractConventionsResult, Skill } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { RepoRepository } from '../repos/repository.js';
import { SkillsService } from '../skills/service.js';
import {
  ConventionsRepository,
  toConventionDto,
  type UpdateConvention,
} from './repository.js';
import { extractConventions } from './extractor.js';

export interface UpdateConventionInput {
  status?: 'pending' | 'accepted' | 'rejected';
  rule?: string;
  snippet?: string;
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private reposRepo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.reposRepo = new RepoRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<Convention[]> {
    const rows = await this.repo.listForRepo(workspaceId, repoId);
    return rows.map(toConventionDto);
  }

  async update(
    workspaceId: string,
    repoId: string,
    id: string,
    patch: UpdateConventionInput,
  ): Promise<Convention | undefined> {
    const row = await this.repo.update(workspaceId, id, patch as UpdateConvention);
    return row ? toConventionDto(row) : undefined;
  }

  async extract(workspaceId: string, repoId: string): Promise<ExtractConventionsResult> {
    const repoRow = await this.reposRepo.getById(workspaceId, repoId);
    if (!repoRow?.clonePath) {
      const msg = `Repository not cloned yet (clonePath is null for repo ${repoId}). Sync the repo first.`;
      console.error(`[conventions] ${msg}`);
      return { conventions: [], sample_count: 0, scanned_at: new Date().toISOString(), error: msg };
    }

    const result = await extractConventions(
      this.container,
      workspaceId,
      repoId,
      repoRow.fullName,
      repoRow.clonePath,
    );

    if (result.error) {
      console.error(`[conventions] ${result.error}`);
      return {
        conventions: [],
        sample_count: result.sampleCount,
        scanned_at: new Date().toISOString(),
        error: result.error,
      };
    }

    await this.repo.deleteStale(repoId);
    const rows = await this.repo.insertBatch(
      result.candidates.map((c) => ({
        workspaceId,
        repoId,
        category: c.category,
        rule: c.rule,
        filePath: c.evidence.file,
        lineStart: c.evidence.lineStart,
        lineEnd: c.evidence.lineEnd,
        snippet: c.snippet,
        confidence: c.confidence,
      })),
    );

    return {
      conventions: rows.map(toConventionDto),
      sample_count: result.sampleCount,
      scanned_at: new Date().toISOString(),
    };
  }

  async createSkillFromAccepted(
    workspaceId: string,
    repoId: string,
    name: string,
    description: string,
  ): Promise<Skill> {
    const repoRow = await this.reposRepo.getById(workspaceId, repoId);
    const repoName = repoRow?.fullName ?? repoId;

    const accepted = await this.repo.listAccepted(workspaceId, repoId);
    const slug = repoName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let body = `# ${slug}-conventions\n\nHouse conventions for \`${repoName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.\n`;
    for (const c of accepted) {
      const sectionSlug = (c.category ?? 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'general';
      body += `\n## ${sectionSlug}\n${c.rule}\n\nDetected in \`${c.evidencePath}:${c.lineStart}-${c.lineEnd}\`:\n\`\`\`\n${c.evidenceSnippet ?? ''}\n\`\`\`\n`;
    }

    const skills = new SkillsService(this.container);
    return skills.create(workspaceId, {
      name,
      description,
      type: 'convention',
      source: 'extracted',
      body,
      enabled: true,
    });
  }
}
