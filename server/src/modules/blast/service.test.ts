import { describe, it, expect } from 'vitest';
import { mapBlast } from './service.js';
import type { BlastResult } from '../repo-intel/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESULT_FULL: BlastResult = {
  changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }],
  callers: [{ file: 'b.ts', symbol: 'handler', viaSymbol: 'foo', line: 10, rank: 5 }],
  factsByFile: { 'b.ts': { endpoints: ['GET /api'], crons: [] } },
  impactedEndpoints: ['GET /api'],
  degraded: false,
};

const ENDPOINTS_BY_SEED = { 'a.ts': ['POST /hook'] };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mapBlast', () => {
  it('full result → correct downstream grouping and endpoint union', () => {
    const blast = mapBlast(RESULT_FULL, ENDPOINTS_BY_SEED);

    expect(blast.downstream).toHaveLength(1);
    const entry = blast.downstream[0]!;
    expect(entry.symbol).toBe('foo');
    expect(entry.callers).toEqual([{ name: 'handler', file: 'b.ts', line: 10 }]);
    // Union of factsByFile['b.ts'].endpoints + endpointsBySeed['a.ts']
    expect(entry.endpoints_affected).toContain('GET /api');
    expect(entry.endpoints_affected).toContain('POST /hook');
    expect(entry.endpoints_affected).toHaveLength(2);
  });

  it('degraded result → summary includes "Index degraded"', () => {
    const degraded: BlastResult = {
      ...RESULT_FULL,
      degraded: true,
      reason: 'index_failed',
    };
    const blast = mapBlast(degraded, {});
    expect(blast.summary).toContain('Index degraded');
    expect(blast.summary).toContain('index_failed');
    expect(blast.summary).toContain('results may be incomplete');
  });

  it('empty result → summary is "No top-level symbols changed."', () => {
    const empty: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    };
    const blast = mapBlast(empty, {});
    expect(blast.summary).toBe('No top-level symbols changed.');
  });

  it('caller in declaration file is excluded', () => {
    // Caller file matches the changed symbol's file → must be excluded
    const result: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }],
      callers: [{ file: 'a.ts', symbol: 'internalHelper', viaSymbol: 'foo', line: 5, rank: 1 }],
      impactedEndpoints: [],
      degraded: false,
    };
    const blast = mapBlast(result, {});
    expect(blast.downstream[0]!.callers).toHaveLength(0);
  });

  it('summary format matches exact template', () => {
    // 1 symbol, 1 caller (non-decl), 2 endpoints (factsByFile union endpointsBySeed)
    const blast = mapBlast(RESULT_FULL, ENDPOINTS_BY_SEED);
    expect(blast.summary).toBe('1 symbol(s) changed · 1 caller(s) · 2 endpoint(s) affected.');
  });

  it('per-symbol cap: >20 callers for same viaSymbol → at most 20 in downstream entry', () => {
    const manyCallers = Array.from({ length: 25 }, (_, i) => ({
      file: `caller-${i}.ts`,
      symbol: `fn${i}`,
      viaSymbol: 'foo',
      line: i + 1,
      rank: i,
    }));
    const result: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }],
      callers: manyCallers,
      impactedEndpoints: [],
      degraded: false,
    };
    const blast = mapBlast(result, {});
    expect(blast.downstream[0]!.callers.length).toBe(20);
  });
});
