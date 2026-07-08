/**
 * architecture.test.ts — unit tests for buildArchitectureDiagram (AC-11)
 *
 * Oracle: AC-11 observable — "12 candidate nodes → ≤ 8 nodes + 1 overflow node"
 */

import { describe, it, expect } from 'vitest';
import { buildArchitectureDiagram, DIAGRAM_NODE_MAX } from './architecture.js';

// ---------------------------------------------------------------------------
// AC-11: 12 → ≤8 + 1 overflow
// ---------------------------------------------------------------------------

describe('buildArchitectureDiagram — AC-11: overflow collapse', () => {
  it('collapses 12 candidates into ≤8 regular nodes + exactly 1 overflow node', () => {
    // Observable: 12 candidate nodes → ≤ 8 nodes + 1 overflow node
    const topFiles = Array.from({ length: 12 }, (_, i) => `src/file${i}.ts`);
    const edges: Array<{ from: string; to: string }> = [];

    const { nodes } = buildArchitectureDiagram({ topFiles, edges });

    const regularNodes = nodes.filter((n) => n.kind !== 'overflow');
    const overflowNodes = nodes.filter((n) => n.kind === 'overflow');

    expect(regularNodes.length).toBeLessThanOrEqual(DIAGRAM_NODE_MAX);
    expect(overflowNodes).toHaveLength(1);

    // Total nodes = regular + 1 overflow
    expect(nodes.length).toBe(regularNodes.length + 1);
  });

  it('does NOT create an overflow node when candidates are exactly at the cap (8)', () => {
    const topFiles = Array.from({ length: 8 }, (_, i) => `src/mod${i}.ts`);
    const { nodes } = buildArchitectureDiagram({ topFiles, edges: [] });

    const overflowNodes = nodes.filter((n) => n.kind === 'overflow');
    expect(overflowNodes).toHaveLength(0);
    expect(nodes.length).toBe(8);
  });

  it('does NOT create an overflow node when candidates are fewer than the cap', () => {
    const topFiles = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const { nodes } = buildArchitectureDiagram({ topFiles, edges: [] });

    const overflowNodes = nodes.filter((n) => n.kind === 'overflow');
    expect(overflowNodes).toHaveLength(0);
    expect(nodes.length).toBe(3);
  });

  it('overflow node label indicates how many extra files were collapsed', () => {
    const topFiles = Array.from({ length: 12 }, (_, i) => `src/mod${i}.ts`);
    const { nodes } = buildArchitectureDiagram({ topFiles, edges: [] });

    const overflowNode = nodes.find((n) => n.kind === 'overflow');
    expect(overflowNode).toBeDefined();
    // The overflow label should mention the collapsed count (12 - 8 = 4)
    expect(overflowNode?.label).toMatch(/4/);
  });

  it('returned regular nodes have kind:"file"', () => {
    const topFiles = ['src/index.ts', 'src/service.ts', 'src/utils.ts'];
    const { nodes } = buildArchitectureDiagram({ topFiles, edges: [] });

    nodes.forEach((n) => {
      // overflow node or file node
      expect(['file', 'overflow']).toContain(n.kind);
    });
    const fileNodes = nodes.filter((n) => n.kind === 'file');
    expect(fileNodes.length).toBe(3);
  });

  it('returns empty diagram for empty topFiles (degraded / no-index skeleton case)', () => {
    const diagram = buildArchitectureDiagram({ topFiles: [], edges: [] });
    expect(diagram.nodes).toHaveLength(0);
    expect(diagram.edges).toHaveLength(0);
  });

  it('edges between kept nodes are preserved', () => {
    const topFiles = ['src/a.ts', 'src/b.ts'];
    const edges = [{ from: 'src/a.ts', to: 'src/b.ts' }];

    const diagram = buildArchitectureDiagram({ topFiles, edges });
    expect(diagram.edges).toHaveLength(1);
    expect(diagram.edges[0]).toMatchObject({ from: 'src/a.ts', to: 'src/b.ts' });
  });

  it('edges to overflowed nodes are remapped to the overflow node', () => {
    // 9 files: first 8 kept, 9th → overflow; edge from kept to overflow-bound file
    const topFiles = Array.from({ length: 9 }, (_, i) => `src/m${i}.ts`);
    const edges = [
      { from: 'src/m0.ts', to: 'src/m8.ts' }, // m8 will be overflow
    ];

    const diagram = buildArchitectureDiagram({ topFiles, edges });
    // The edge should be remapped to the overflow node
    const remapped = diagram.edges.find((e) => e.from === 'src/m0.ts');
    expect(remapped).toBeDefined();
    expect(remapped?.to).toBe('__overflow__');
  });

  it('self-loops arising from overflow remapping are dropped', () => {
    // Both endpoints overflow → self-loop → dropped
    const topFiles = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
    // Edge between two files that will both be in the overflow set
    const edges = [{ from: 'src/f8.ts', to: 'src/f9.ts' }];

    const diagram = buildArchitectureDiagram({ topFiles, edges });
    // f8 and f9 both overflow → remapped to __overflow__ → self-loop → removed
    const selfLoops = diagram.edges.filter((e) => e.from === e.to);
    expect(selfLoops).toHaveLength(0);
  });
});
