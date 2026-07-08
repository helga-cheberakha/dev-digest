/**
 * criticalPaths.test.ts — unit tests for buildCriticalPaths (AC-12)
 *
 * Oracle: AC-12 observable — "output contains only file-kind entries, each
 * with rationale + link; seeded service entry rejected"
 */

import { describe, it, expect } from 'vitest';
import { buildCriticalPaths } from './criticalPaths.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const buildLink = (path: string) => `https://github.com/owner/repo/blob/sha123/${path}`;

// ---------------------------------------------------------------------------
// AC-12: 5–8 file-only entries with rationale + link; rejects service entries
// ---------------------------------------------------------------------------

describe('buildCriticalPaths — AC-12: file-only entries, rejects non-file', () => {
  it('returns entries only for file-path nodes (containing a "." in their last segment)', () => {
    // Observable: output contains only file-kind entries — entries with file extensions.
    // Bare service/package names (no "." in last segment) must be rejected.
    const chains: string[][] = [
      ['src/index.ts', 'src/router.ts', 'src/auth.ts'],
      ['auth-service', 'src/middleware.ts'],   // 'auth-service' has no extension → rejected
      ['express', 'src/server.ts'],              // 'express' has no extension → rejected
    ];

    const result = buildCriticalPaths(chains, buildLink);

    // All returned entries must be file paths (last segment contains '.')
    for (const entry of result) {
      const lastSegment = entry.file.split('/').pop() ?? '';
      expect(lastSegment).toMatch(/\./);
    }

    // 'auth-service' and 'express' must not appear in the output
    const files = result.map((e) => e.file);
    expect(files).not.toContain('auth-service');
    expect(files).not.toContain('express');
  });

  it('each entry has rationale and link populated', () => {
    const chains: string[][] = [
      ['src/service.ts', 'src/helpers.ts'],
    ];

    const result = buildCriticalPaths(chains, buildLink);

    expect(result.length).toBeGreaterThan(0);
    for (const entry of result) {
      expect(typeof entry.rationale).toBe('string');
      expect(entry.rationale.length).toBeGreaterThan(0);
      expect(entry.link).toBe(buildLink(entry.file));
    }
  });

  it('rejects a seeded service-name entry that has no file extension', () => {
    // AC-12 explicit: "rejects non-file (e.g. service) entries"
    const chains: string[][] = [
      ['auth-service', 'billing-service', 'notification-service'],
      ['src/api.ts'],
    ];

    const result = buildCriticalPaths(chains, buildLink);

    // Only src/api.ts should survive; the service names must be stripped
    const files = result.map((e) => e.file);
    expect(files).not.toContain('auth-service');
    expect(files).not.toContain('billing-service');
    expect(files).not.toContain('notification-service');
    expect(files).toContain('src/api.ts');
  });

  it('returns [] for empty chains input (degraded / no-index skeleton case)', () => {
    const result = buildCriticalPaths([], buildLink);
    expect(result).toHaveLength(0);
  });

  it('caps output at 8 entries when many chains are provided', () => {
    // Generate 20 unique files across chains to ensure cap is enforced
    const chains: string[][] = Array.from({ length: 10 }, (_, i) => [
      `src/module${i * 2}.ts`,
      `src/module${i * 2 + 1}.ts`,
    ]);

    const result = buildCriticalPaths(chains, buildLink);
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it('link is constructed correctly from the buildLink callback', () => {
    const chains: string[][] = [['src/core/engine.ts']];
    const result = buildCriticalPaths(chains, buildLink);

    expect(result).toHaveLength(1);
    expect(result[0]?.link).toBe('https://github.com/owner/repo/blob/sha123/src/core/engine.ts');
  });

  it('gives higher importance to files that appear as chain roots', () => {
    const chains: string[][] = [
      ['src/root.ts', 'src/dep.ts'],
    ];

    const result = buildCriticalPaths(chains, buildLink);
    const files = result.map((e) => e.file);

    // Chain root must appear in the output
    expect(files).toContain('src/root.ts');

    // The first entry (highest importance) should be the root
    expect(files[0]).toBe('src/root.ts');
  });
});
