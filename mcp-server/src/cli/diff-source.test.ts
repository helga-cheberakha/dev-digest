/**
 * Unit tests for WorkingTreeDiffSource (via createDiffSource) and the factory.
 *
 * `node:child_process` is mocked at the module level so no real `git` process
 * is spawned.  The mock captures the callback that `util.promisify` appends and
 * calls it synchronously — which is all the production code needs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { createDiffSource, GitNotARepoError, GitDiffError } from './diff-source.js';

// Hoisted by vitest — in effect before any module is imported.
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drive the mock to call its promisify callback with a success result. */
function mockSuccess(stdout: string): void {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (...args: unknown[]) => {
      const cb = args[args.length - 1] as (
        err: null,
        result: { stdout: string; stderr: string },
      ) => void;
      cb(null, { stdout, stderr: '' });
    },
  );
}

/** Drive the mock to call its promisify callback with an error. */
function mockError(stderr: string, code = 1): void {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error) => void;
      const err = Object.assign(new Error('git failed'), { code, stderr });
      cb(err);
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkingTreeDiffSource', () => {
  const cwd = '/tmp/fake-repo';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('acquire() resolves with raw diff string on success', async () => {
    const expected = 'diff --git a/src/app.ts b/src/app.ts\n+const x = 1;\n';
    mockSuccess(expected);

    const source = createDiffSource('working', cwd);
    const result = await source.acquire();

    expect(result).toBe(expected);
  });

  it('acquire() throws GitNotARepoError with code "not_a_repo" when stderr contains "not a git repository"', async () => {
    mockError(
      'fatal: not a git repository (or any of the parent directories): .git',
      128,
    );

    const source = createDiffSource('working', cwd);
    let caught: unknown;
    try {
      await source.acquire();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(GitNotARepoError);
    expect((caught as GitNotARepoError).code).toBe('not_a_repo');
  });

  it('acquire() throws GitDiffError on a generic non-zero exit', async () => {
    mockError('error: some other git problem', 1);

    const source = createDiffSource('working', cwd);
    let caught: unknown;
    try {
      await source.acquire();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(GitDiffError);
    expect((caught as GitDiffError).message).toContain('error: some other git problem');
  });

  it('createDiffSource("staged", cwd) throws a descriptive "not yet implemented" error', () => {
    expect(() => createDiffSource('staged', cwd)).toThrow(/not yet implemented/i);
  });
});
