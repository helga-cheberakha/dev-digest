import { eq } from 'drizzle-orm';
import { Intent } from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { Container } from '../../platform/container.js';
import type { IntentRepository, PrIntentRow } from './repository.js';
import * as t from '../../db/schema.js';

const SYSTEM_PROMPT =
  'You are a concise PR intent classifier. Given a PR title, description, and list of ' +
  'changed files (hunk headers only), extract the PR\'s intent as a structured object. ' +
  'Be brief and precise. "summary" is one sentence. "in_scope" and "out_of_scope" are ' +
  'short bullet phrases (3–5 each). "risk_areas" are notable risk signals (0–3 phrases).';

export class IntentService {
  constructor(
    private container: Container,
    private repo: IntentRepository,
  ) {}

  async getIntent(prId: string): Promise<PrIntentRow | null> {
    return this.repo.findByPrId(prId);
  }

  async classifyIntent(prId: string, workspaceId: string): Promise<PrIntentRow> {
    // 1. Load PR row
    const [pull] = await this.container.db
      .select({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
        repoId: t.pullRequests.repoId,
      })
      .from(t.pullRequests)
      .where(eq(t.pullRequests.id, prId));
    if (!pull) throw new Error(`PR not found: ${prId}`);

    // 2. Load file patches and extract hunk-headers-only
    const files = await this.container.db
      .select({ path: t.prFiles.path, patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));

    const estimatedFullDiffTokens = Math.ceil(
      files.reduce((sum, f) => sum + (f.patch?.length ?? 0), 0) / 4,
    );

    const fileHeaders = files.map(({ path, patch }) => {
      const hunkLines = (patch ?? '').split('\n').filter((l) => l.startsWith('@@'));
      return hunkLines.length > 0 ? `### ${path}\n${hunkLines.join('\n')}` : `### ${path}`;
    });

    // 3. Linked issue — best-effort via GitHub (needs repo owner/name)
    let linkedIssueBody = '';
    try {
      const [repo] = await this.container.db
        .select({ owner: t.repos.owner, name: t.repos.name })
        .from(t.repos)
        .where(eq(t.repos.id, pull.repoId));
      if (repo) {
        const gh = await this.container.github();
        const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pull.number);
        if (detail.linked_issue?.body) {
          linkedIssueBody = detail.linked_issue.body.slice(0, 2000);
        }
      }
    } catch {
      // GitHub unavailable or no linked issue — degrade gracefully
    }

    // 4. Resolve cheap feature model
    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'review_intent',
    );

    // 5. Build user message — wrap every user-supplied field to prevent prompt injection
    const sections: string[] = [
      `## PR Title\n${wrapUntrusted('pr-title', pull.title)}`,
      ...(pull.body?.trim()
        ? [`## PR Body\n${wrapUntrusted('pr-body', pull.body.slice(0, 3000))}`]
        : []),
      ...(linkedIssueBody
        ? [`## Linked Issue\n${wrapUntrusted('linked-issue', linkedIssueBody)}`]
        : []),
      `## Changed Files (hunk headers only)\n${
        fileHeaders.length > 0
          ? wrapUntrusted('file-headers', fileHeaders.join('\n'))
          : '(no files)'
      }`,
    ];

    // 6. Call LLM with structured output
    const llm = await this.container.llm(provider);
    const result = await llm.completeStructured<Intent>({
      model,
      schema: Intent,
      schemaName: 'Intent',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: sections.join('\n\n') },
      ],
    });

    // 7. Log token savings (both estimates use chars/4 so the comparison is apples-to-apples)
    const estimatedHunkTokens = Math.ceil(
      fileHeaders.reduce((sum, h) => sum + h.length, 0) / 4,
    );
    const tokensSaved = estimatedFullDiffTokens - estimatedHunkTokens;
    console.info(
      `[intent] PR #${pull.number}: tokensIn=${result.tokensIn}, ` +
        `diffEst=${estimatedFullDiffTokens}, hunkEst=${estimatedHunkTokens}, saved≈${tokensSaved}`,
    );

    // 8. Persist and return
    return this.repo.upsert({
      prId,
      summary: result.data.summary,
      inScope: result.data.in_scope,
      outOfScope: result.data.out_of_scope,
      riskAreas: result.data.risk_areas ?? null,
      model: `${provider}/${model}`,
      tokensSaved,
    });
  }
}
