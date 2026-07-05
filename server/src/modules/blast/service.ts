import type { BlastRadius, BlastCaller, DownstreamImpact } from '@devdigest/shared';
import type { BlastResult } from '../repo-intel/types.js';
import type { Container } from '../../platform/container.js';

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
    const totalEndpoints = downstream.reduce((sum, d) => sum + d.endpoints_affected.length, 0);
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
 */
export async function buildBlast(
  container: Container,
  repoId: string,
  changedFiles: string[],
): Promise<BlastRadius> {
  const [result, endpointsBySeed] = await Promise.all([
    container.repoIntel.getBlastRadius(repoId, changedFiles),
    container.repoIntel
      .getReachableEndpoints(repoId, changedFiles, 2)
      .catch(() => ({} as Record<string, string[]>)),
  ]);
  return mapBlast(result, endpointsBySeed);
}
