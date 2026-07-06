/**
 * Unit tests for the terminal output renderer.
 *
 * - resolveExitCode: one test per FailOnPolicy variant (plus an extra for
 *   the critical/warning boundary), exercised against a mixed-severity set.
 * - renderFindings: stdout captured via vi.spyOn to assert the presence of
 *   severity labels, file:line, and finding titles in the rendered output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { resolveExitCode, renderFindings } from './output.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const makeFinding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'f-test',
  severity: 'CRITICAL',
  category: 'bug',
  title: 'Test finding',
  file: 'src/foo.ts',
  start_line: 1,
  end_line: 1,
  rationale: 'Rationale text.',
  confidence: 0.9,
  ...overrides,
});

// ---------------------------------------------------------------------------
// resolveExitCode
// ---------------------------------------------------------------------------

describe('resolveExitCode', () => {
  const critical = makeFinding({ severity: 'CRITICAL' });
  const warning  = makeFinding({ severity: 'WARNING' });
  const suggest  = makeFinding({ severity: 'SUGGESTION' });

  it('"critical" policy returns 1 when a CRITICAL finding is present', () => {
    expect(resolveExitCode([critical, warning, suggest], 'critical')).toBe(1);
  });

  it('"critical" policy returns 0 when only WARNING/SUGGESTION findings are present', () => {
    expect(resolveExitCode([warning, suggest], 'critical')).toBe(0);
  });

  it('"warning" policy returns 1 when a WARNING finding is present', () => {
    expect(resolveExitCode([warning, suggest], 'warning')).toBe(1);
  });

  it('"any" policy returns 1 even for a SUGGESTION-only list', () => {
    expect(resolveExitCode([suggest], 'any')).toBe(1);
  });

  it('"never" policy always returns 0 regardless of findings', () => {
    expect(resolveExitCode([critical, warning, suggest], 'never')).toBe(0);
  });

  it('returns 0 with an empty findings list for any policy', () => {
    expect(resolveExitCode([], 'any')).toBe(0);
    expect(resolveExitCode([], 'critical')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// renderFindings
// ---------------------------------------------------------------------------

describe('renderFindings', () => {
  let writes: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let spy: any;

  beforeEach(() => {
    writes = [];
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('renders severity label, file:line, and title for each finding', () => {
    const findings = [
      makeFinding({
        severity: 'CRITICAL',
        title: 'Hardcoded secret key',
        file: 'src/config.ts',
        start_line: 42,
        end_line: 42,
      }),
      makeFinding({
        severity: 'WARNING',
        title: 'Missing null check',
        file: 'src/utils.ts',
        start_line: 7,
        end_line: 7,
      }),
    ];

    renderFindings(findings);
    const output = writes.join('');

    // Severity labels
    expect(output).toContain('[CRITICAL]');
    expect(output).toContain('[WARNING]');
    // file:line references
    expect(output).toContain('src/config.ts:42');
    expect(output).toContain('src/utils.ts:7');
    // Titles
    expect(output).toContain('Hardcoded secret key');
    expect(output).toContain('Missing null check');
    // Trailing summary line
    expect(output).toContain('1 critical');
    expect(output).toContain('1 warning');
  });

  it('outputs "No findings" message when the findings list is empty', () => {
    renderFindings([]);
    const output = writes.join('');
    expect(output).toContain('No findings');
  });
});
