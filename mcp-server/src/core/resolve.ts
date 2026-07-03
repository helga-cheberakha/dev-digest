import type { Client } from '../http/client.js';

// ---- Repo resolution ----

type RepoOk  = { repoId: string; fullName: string };
type RepoErr = { error: string };

export async function resolveRepoId(
  client: Client,
  repo: string,
): Promise<RepoOk | RepoErr> {
  const repos = await client.listRepos();

  const needle = repo.toLowerCase();
  const matches = repos.filter(r =>
    r.full_name.toLowerCase() === needle ||
    r.name.toLowerCase() === needle ||
    `${r.owner}/${r.name}`.toLowerCase() === needle,
  );

  if (matches.length === 1) {
    return { repoId: matches[0]!.id, fullName: matches[0]!.full_name };
  }
  if (matches.length === 0) {
    const available = repos.map(r => r.full_name).join(', ');
    return { error: `Repo '${repo}' not found in DevDigest. Available: ${available || 'none'}. Pass owner/name (e.g. octocat/hello).` };
  }
  // multiple matches — ambiguous bare name
  const names = matches.map(r => r.full_name).join(', ');
  return { error: `Ambiguous repo name '${repo}' — multiple matches: ${names}. Pass owner/name to disambiguate.` };
}

// ---- PR resolution ----

type PullOk  = { repoId: string; pullId: string; fullName: string };
type PullErr = { error: string };

export async function resolvePullId(
  client: Client,
  repo: string,
  pr: number,
): Promise<PullOk | PullErr> {
  const repoResult = await resolveRepoId(client, repo);
  if ('error' in repoResult) return repoResult;

  const { repoId, fullName } = repoResult;
  const pulls = await client.listPulls(repoId);

  const found = pulls.find(p => p.number === pr && p.id != null);
  if (found) {
    return { repoId, pullId: found.id!, fullName };
  }

  const openNumbers = pulls
    .filter(p => p.id != null)
    .slice(0, 10)
    .map(p => `#${p.number}`)
    .join(', ');
  return {
    error: `PR #${pr} not found in '${fullName}'. Known PRs: ${openNumbers || 'none synced yet'}.`,
  };
}
