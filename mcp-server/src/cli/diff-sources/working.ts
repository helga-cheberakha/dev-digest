/**
 * WorkingTreeDiffSource — captures `git diff` (unstaged working-copy changes).
 *
 * Uses `execFile` (not `exec`) to avoid shell interpretation of arguments,
 * consistent with the security-skill command-injection guidance.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DiffSource } from '../diff-source.js';
import { GitNotARepoError, GitDiffError } from '../diff-source.js';

const execFileAsync = promisify(execFile);

export class WorkingTreeDiffSource implements DiffSource {
  constructor(private readonly cwd: string) {}

  async acquire(): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['diff'], {
        cwd: this.cwd,
        encoding: 'utf8',
      });
      return stdout;
    } catch (err) {
      // execFile rejects with an error that carries `.stderr` on non-zero exit.
      const stderr =
        (err as { stderr?: string | Buffer | null }).stderr?.toString() ?? '';

      if (stderr.toLowerCase().includes('not a git repository')) {
        throw new GitNotARepoError(this.cwd);
      }

      throw new GitDiffError(stderr || String(err));
    }
  }
}
