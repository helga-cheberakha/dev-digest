import { stat } from 'node:fs/promises';
import type { Skill, SkillVersion } from '@devdigest/shared';
import { and, asc, eq } from 'drizzle-orm';
import { unzipSync, strFromU8 } from 'fflate';
import type { Container } from '../../platform/container.js';
import { repos } from '../../db/schema.js';
import { SkillsRepository } from './repository.js';
import type { SkillStats } from './repository.js';
import { toSkillDto, toSkillVersionDto } from './helpers.js';
import { ValidationError } from '../../platform/errors.js';
import { detectInjection } from './injection-detector.js';
import { guardPath } from '../project-context/path-guard.js';

export type { SkillStats };

export interface CreateSkillInput {
  name: string;
  description?: string;
  type?: 'rubric' | 'convention' | 'security' | 'custom';
  source?: 'manual' | 'imported_url' | 'extracted' | 'community';
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: 'rubric' | 'convention' | 'security' | 'custom';
  source?: 'manual' | 'imported_url' | 'extracted' | 'community';
  body?: string;
  enabled?: boolean;
  version_message?: string;
}

export interface ImportPreviewResult {
  name: string;
  description: string;
  type: 'rubric' | 'convention' | 'security' | 'custom';
  source: 'imported_url';
  body: string;
  ignored_files: string[];
  injection_detected: boolean;
}

const MAX_IMPORT_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * A1 — skills service. Business logic for the Skills tab.
 *
 * A Skill = name + description + type + source + body + enabled + versioned.
 * Body changes are versioned via `skill_versions` (repository).
 */
export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = container.skillsRepo;
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? '',
      type: input.type ?? 'custom',
      source: input.source ?? 'manual',
      body: input.body,
      enabled: input.enabled,
      injectionDetected: detectInjection(input.body),
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.body !== undefined ? { injectionDetected: detectInjection(patch.body) } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.version_message !== undefined ? { message: patch.version_message } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Config history for a skill, newest version first. Workspace-scoped: returns
   * undefined when the skill isn't in this workspace (the route maps that to 404).
   */
  async listVersions(
    workspaceId: string,
    skillId: string,
  ): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /**
   * Restore a skill to a previous body version. Returns undefined when the skill
   * or the requested version doesn't exist in this workspace.
   */
  async restore(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<Skill | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.restore(workspaceId, skillId, version);
    return row ? toSkillDto(row) : undefined;
  }

  // ---- document attachments ------------------------------------------------

  /**
   * Ordered document paths attached to a skill. Returns undefined when the skill
   * is not found in this workspace (route maps to 404).
   */
  async getDocuments(workspaceId: string, skillId: string): Promise<string[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return this.repo.documentsForSkill(skillId);
  }

  /**
   * Replace the full ordered set of attached documents for a skill. Every path is
   * validated via the path-guard (AC-8) before persisting. Post-normalization
   * duplicates are silently dropped (first occurrence wins). Returns undefined
   * when the skill is not found. Throws ValidationError if any path fails the guard.
   *
   * When `repoId` is provided the clone root is resolved to that specific repo
   * (workspace-scoped); when absent a deterministic fallback is used (oldest repo
   * that has a clone on disk).
   */
  async setDocuments(
    workspaceId: string,
    skillId: string,
    paths: string[],
    repoId?: string,
  ): Promise<string[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;

    const cloneRoot = await this.resolveCloneRoot(workspaceId, repoId);

    const seen = new Set<string>();
    const validated: string[] = [];
    for (const candidate of paths) {
      const result = await guardPath(candidate, cloneRoot);
      if (!result.ok) {
        throw new ValidationError(
          `Invalid document path "${candidate}": ${result.reason}`,
        );
      }
      if (!seen.has(result.path)) {
        seen.add(result.path);
        validated.push(result.path);
      }
    }

    await this.repo.setDocuments(skillId, validated);
    return this.repo.documentsForSkill(skillId);
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

  /** Usage and finding stats for a skill. Returns undefined when not found. */
  async stats(workspaceId: string, skillId: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return this.repo.stats(skillId);
  }

  /**
   * Parse a file upload and return a preview of what would be created — WITHOUT
   * persisting anything. Supports .md and .zip only. Max 5 MB.
   */
  importPreview(filename: string, base64: string): ImportPreviewResult {
    const buf = Buffer.from(base64, 'base64');

    if (buf.byteLength > MAX_IMPORT_SIZE) {
      throw new ValidationError(
        `File too large: ${buf.byteLength} bytes (max ${MAX_IMPORT_SIZE} bytes)`,
      );
    }

    const lower = filename.toLowerCase();

    if (lower.endsWith('.md')) {
      const text = buf.toString('utf-8');
      const name = extractMarkdownTitle(text) ?? stemFromFilename(filename);
      return {
        name,
        description: '',
        type: 'custom',
        source: 'imported_url',
        body: text,
        ignored_files: [],
        injection_detected: detectInjection(text),
      };
    }

    if (lower.endsWith('.zip')) {
      const entries = unzipSync(new Uint8Array(buf));
      const paths = Object.keys(entries);

      // Find SKILL.md first, then fall back to the first top-level *.md
      const skillMdPath = paths.find((p) => p.toUpperCase() === 'SKILL.MD');
      const firstMdPath =
        skillMdPath ??
        paths.find((p) => !p.includes('/') && p.toLowerCase().endsWith('.md'));

      if (!firstMdPath) {
        throw new ValidationError('No .md file found in the zip archive');
      }

      const bodyBytes = entries[firstMdPath];
      if (!bodyBytes) {
        throw new ValidationError(`Could not read ${firstMdPath} from the zip archive`);
      }
      const body = strFromU8(bodyBytes);
      const name = extractMarkdownTitle(body) ?? stemFromFilename(firstMdPath);

      const ignoredFiles = paths.filter((p) => p !== firstMdPath && !p.endsWith('/'));

      return {
        name,
        description: '',
        type: 'custom',
        source: 'imported_url',
        body,
        ignored_files: ignoredFiles,
        injection_detected: detectInjection(body),
      };
    }

    throw new ValidationError(
      `Unsupported file type: "${filename}". Only .md and .zip are supported.`,
    );
  }

  /**
   * Fetch a remote URL and return a preview of the skill content — WITHOUT
   * persisting anything. Supports plain text URLs, GitHub Gist pages, and
   * GitHub blob viewer URLs. Max 100 KB. Blocks private addresses (SSRF guard).
   */
  async importPreviewUrl(url: string): Promise<ImportPreviewResult> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ValidationError('Invalid URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ValidationError('Only http/https URLs are allowed');
    }

    // SSRF guard — run on the original URL before any transformation.
    const privateRange = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1$)/;
    if (privateRange.test(parsed.hostname)) {
      throw new ValidationError('URL points to a private or internal address');
    }

    const { fetchUrl, isGistApi, fallbackName } = resolveGitHubUrl(url);

    if (isGistApi) {
      return this.importPreviewFromGistApi(fetchUrl, fallbackName);
    }

    // Standard text fetch (also handles raw.githubusercontent.com and transformed blob URLs).
    let res: Response;
    try {
      res = await fetch(fetchUrl, { signal: AbortSignal.timeout(5000) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      throw new ValidationError(`Could not fetch URL: ${msg}`);
    }

    if (!res.ok) {
      throw new ValidationError(`Fetch failed with status ${res.status}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('text/')) {
      throw new ValidationError('URL must return a text document (text/*)');
    }

    const text = await res.text();
    if (text.length > 100 * 1024) {
      throw new ValidationError('Response exceeds the 100 KB limit');
    }

    const name =
      extractMarkdownTitle(text) ??
      fallbackName ??
      stemFromFilename(new URL(fetchUrl).pathname) ??
      'Imported skill';

    return {
      name,
      description: '',
      type: 'custom',
      source: 'imported_url',
      body: text,
      ignored_files: [],
      injection_detected: detectInjection(text),
    };
  }

  private async importPreviewFromGistApi(
    apiUrl: string,
    fallbackName: string | undefined,
  ): Promise<ImportPreviewResult> {
    let res: Response;
    try {
      res = await fetch(apiUrl, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      throw new ValidationError(`Could not fetch Gist: ${msg}`);
    }

    if (!res.ok) {
      throw new ValidationError(`GitHub API returned ${res.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const files: Array<{ filename: string; content: string; truncated: boolean; raw_url: string }> =
      Object.values(data.files ?? {});

    if (files.length === 0) {
      throw new ValidationError('Gist contains no files');
    }

    // Prefer the first .md file; fall back to the first file overall.
    const file =
      files.find((f) => f.filename.toLowerCase().endsWith('.md')) ?? files[0]!;

    let text: string;
    if (file.truncated) {
      // Content was too large for the API response; fetch the raw URL.
      const rawRes = await fetch(file.raw_url, { signal: AbortSignal.timeout(5000) });
      if (!rawRes.ok) throw new ValidationError(`Could not fetch Gist raw content: ${rawRes.status}`);
      text = await rawRes.text();
    } else {
      text = file.content;
    }

    if (text.length > 100 * 1024) {
      throw new ValidationError('Gist content exceeds the 100 KB limit');
    }

    const name =
      extractMarkdownTitle(text) ??
      stemFromFilename(file.filename) ??
      fallbackName ??
      'Imported skill';

    return {
      name,
      description: '',
      type: 'custom',
      source: 'imported_url',
      body: text,
      ignored_files: files.filter((f) => f.filename !== file.filename).map((f) => f.filename),
      injection_detected: detectInjection(text),
    };
  }
}

// ---- private helpers -------------------------------------------------------

/** Extract the first # heading from markdown text, or undefined. */
function extractMarkdownTitle(text: string): string | undefined {
  const match = text.match(/^#\s+(.+)/m);
  return match?.[1]?.trim();
}

/** Return the filename stem (no extension, no path). */
function stemFromFilename(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Transforms human-readable GitHub URLs into machine-fetchable equivalents.
 *
 * - gist.github.com/{user}/{id}  → GitHub Gist API (returns JSON)
 * - github.com/{user}/{repo}/blob/{branch}/{path} → raw.githubusercontent.com
 * - Everything else              → unchanged
 */
function resolveGitHubUrl(url: string): {
  fetchUrl: string;
  isGistApi: boolean;
  fallbackName: string | undefined;
} {
  // GitHub Gist page (with optional query string / trailing slash)
  const gistMatch = url.match(
    /^https?:\/\/gist\.github\.com\/([^/?#]+)\/([0-9a-f]+)\/?(?:[?#].*)?$/i,
  );
  if (gistMatch) {
    return {
      fetchUrl: `https://api.github.com/gists/${gistMatch[2]}`,
      isGistApi: true,
      fallbackName: undefined,
    };
  }

  // GitHub blob viewer: github.com/{user}/{repo}/blob/{branch}/{...path}
  const blobMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/);
  if (blobMatch) {
    const rawUrl = `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}`;
    const filename = blobMatch[2]!.split('/').pop();
    return {
      fetchUrl: rawUrl,
      isGistApi: false,
      fallbackName: filename ? stemFromFilename(filename) : undefined,
    };
  }

  return { fetchUrl: url, isGistApi: false, fallbackName: undefined };
}
