import type { BlastRadius, BlastCaller, DownstreamImpact, PriorPr } from '@devdigest/shared';
import type { BlastResult } from '../repo-intel/types.js';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';

/** Safety-net cap per symbol (ripgrep/degraded path has no rank-based cap). */
const MAX_CALLERS_SAFETY = 20;

/**
 * Pure mapping function — no I/O, deterministic.
 * Converts a raw `BlastResult` + per-seed endpoint map into the `BlastRadius`
 * contract shape consumed by the client.
 */
export function mapBlast(
  result: BlastResult,
  endpointsBySeed: Record<string, string[]>,
): BlastRadius {
  const downstream: DownstreamImpact[] = [];

  for (const changedSymbol of result.changedSymbols) {
    // Filter to callers that reach this symbol, apply safety cap, then exclude
    // callers that live in the same file as the declaration.
    const symbolCallers = result.callers
      .filter((c) => c.viaSymbol === changedSymbol.name)
      .slice(0, MAX_CALLERS_SAFETY)
      .filter((c) => c.file !== changedSymbol.file);

    const callers: BlastCaller[] = symbolCallers.map((c) => ({
      name: c.symbol,
      file: c.file,
      line: c.line,
    }));

    // endpoints_affected: union of per-caller-file facts PLUS seed-level endpoints.
    const endpointsSet = new Set<string>();
    for (const c of symbolCallers) {
      for (const ep of result.factsByFile?.[c.file]?.endpoints ?? []) {
        endpointsSet.add(ep);
      }
    }
    for (const ep of endpointsBySeed[changedSymbol.file] ?? []) {
      endpointsSet.add(ep);
    }

    // crons_affected: union of per-caller-file crons.
    const cronsSet = new Set<string>();
    for (const c of symbolCallers) {
      for (const cr of result.factsByFile?.[c.file]?.crons ?? []) {
        cronsSet.add(cr);
      }
    }

    downstream.push({
      symbol: changedSymbol.name,
      callers,
      endpoints_affected: [...endpointsSet],
      crons_affected: [...cronsSet],
    });
  }

  // Build summary string.
  let summary: string;
  if (result.changedSymbols.length === 0) {
    summary = 'No top-level symbols changed.';
  } else {
    const totalCallers = downstream.reduce((sum, d) => sum + d.callers.length, 0);
    // Deduplicate endpoints across all symbols for the summary count (consistent
    // with the client's blastCounts helper which uses Set dedup).
    const totalEndpoints = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;
    summary = `${result.changedSymbols.length} symbol(s) changed · ${totalCallers} caller(s) · ${totalEndpoints} endpoint(s) affected.`;
  }

  if (result.degraded) {
    summary += ` Index degraded${result.reason ? ' (' + result.reason + ')' : ''} — results may be incomplete.`;
  }

  return {
    changed_symbols: result.changedSymbols,
    downstream,
    summary,
  };
}

/**
 * Async orchestrator — calls the repo-intel facade and maps the result.
 * Never called directly from tests (use `mapBlast` for unit tests).
 *
 * @param log - Optional logger. TODO: replace with `container.log` if a
 *   container-level logger is ever added to Container.
 */
export async function buildBlast(
  container: Container,
  workspaceId: string,
  prId: string,
  log?: { warn: (obj: unknown, msg?: string) => void },
): Promise<BlastRadius> {
  const pr = await container.blastRepo.findPrByWorkspace(workspaceId, prId);
  if (!pr) throw new NotFoundError('Pull request not found');

  const changedFiles = await container.blastRepo.getChangedFiles(pr.id);

  const [result, endpointsBySeed] = await Promise.all([
    container.repoIntel.getBlastRadius(pr.repoId, changedFiles),
    container.repoIntel
      .getReachableEndpoints(pr.repoId, changedFiles, 2)
      .catch(() => ({} as Record<string, string[]>)),
  ]);

  let priorPrs: PriorPr[] = [];
  try {
    const rows = await container.blastRepo.findPriorPrsTouchingSameFiles(
      workspaceId,
      pr.repoId,
      prId,
      changedFiles,
      5,
      50,
    );
    priorPrs = rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      opened_at: r.openedAt?.toISOString() ?? null,
      status: r.status,
    }));
  } catch (e: unknown) {
    log?.warn({ err: e }, 'blast: prior-PR discovery failed — continuing without');
    priorPrs = [];
  }

  const blast = mapBlast(result, endpointsBySeed);
  return { ...blast, prior_prs: priorPrs };
}
