/**
 * review — composition root for the `devdigest review` CLI command.
 *
 * Wires existing adapters (secrets, LLM, diff, diff-parser) to the existing
 * `reviewPullRequest` engine from `@devdigest/reviewer-core`, then renders
 * structured findings to stdout and exits with the appropriate code.
 *
 * This file is the ONLY place allowed to know both a port and its concrete
 * adapter — consistent with the onion-architecture composition-root rule.
 *
 * Usage: devdigest review [options]
 */

import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { reviewPullRequest, OpenRouterProvider } from '@devdigest/reviewer-core';
import { CiFailOn } from '@devdigest/shared';
import type { LLMProvider } from '@devdigest/shared';

import { createDiffSource, DIFF_MODES, GitNotARepoError } from './diff-source.js';
import type { DiffMode } from './diff-source.js';
import { parseUnifiedDiff } from '@devdigest/server/adapters/git/diff-parser.js';
import { LocalSecretsProvider } from '@devdigest/server/adapters/secrets/local.js';
import { OpenAIProvider } from '@devdigest/server/adapters/llm/openai.js';
import { AnthropicProvider } from '@devdigest/server/adapters/llm/anthropic.js';
import { renderFindings, renderSummary, resolveExitCode } from './output.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Keep in sync with seed.ts DEFAULT_MODEL and FEATURE_MODELS in platform.ts
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Built-in system prompt used by the CLI.
 *
 * NOTE: The DevDigest studio stores an agent-specific system prompt in its
 * database; the CLI has no DB connection and cannot retrieve it. This constant
 * is a capable generic code-review prompt that mirrors the starter agent.
 * Future extension: `--system-prompt-file <path>` flag.
 */
const DEFAULT_SYSTEM_PROMPT = `You are an expert code reviewer. Review the provided unified diff thoroughly and return structured findings.

Focus on:
- Correctness: logic errors, off-by-one errors, null/undefined handling, race conditions, incorrect assumptions
- Security: injection vulnerabilities, authentication bypasses, data exposure, input validation gaps
- Maintainability: unclear naming, missing error handling, overly complex logic, dead code
- Performance: unnecessary computations, inefficient algorithms, blocking operations, memory leaks

Rules:
- Only report issues that are clearly present in the diff (do not speculate about unseen code).
- Every finding must cite a specific file and line number from the diff.
- Provide a concrete, actionable suggestion for each finding.
- Do NOT report style nitpicks (whitespace, formatting) as CRITICAL or WARNING.
- Be precise and concise.`;

// ---------------------------------------------------------------------------
// Usage / help
// ---------------------------------------------------------------------------

const USAGE = `DevDigest Pre-Review — review your local diff before opening a PR.

Usage:
  devdigest review [options]

Options:
  --mode <mode>           Diff source: working (default) | staged | branch
  --provider <provider>   LLM provider: openrouter (default) | openai | anthropic
  --model <id>            Model identifier (default: ${DEFAULT_MODEL})
  --fail-on <policy>      Gate policy: critical (default) | warning | any | never
  --verbose               Show full rationale text (not truncated to 300 chars)
  --help, -h              Print this help and exit

Exit codes:
  0   Clean — no findings tripped the --fail-on gate (or diff was empty)
  1   Blocking findings — at least one finding met the --fail-on threshold
  2   Error — runtime failure (not a git repo, missing API key, LLM error, etc.)

Environment / secrets:
  API keys are resolved in order:
    1. DevDigest secrets file (path from DEVDIGEST_SECRETS_PATH env var, or
       ~/.devdigest/secrets.json by default)
    2. process.env (OPENROUTER_API_KEY | OPENAI_API_KEY | ANTHROPIC_API_KEY)

Notes:
  - Progress events are written to stderr; findings are written to stdout.
    Pipe stdout to capture machine-readable output cleanly.
  - The system prompt is a built-in generic code-review prompt — it will NOT
    match your studio agent's DB-stored prompt. Future: --system-prompt-file.
  - Large diffs trigger automatic map-reduce over individual files (strategy auto).
`;

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

class CliCancelledError extends Error {
  constructor() {
    super('Review cancelled by user (SIGINT).');
    this.name = 'CliCancelledError';
  }
}

// ---------------------------------------------------------------------------
// Provider key map
// ---------------------------------------------------------------------------

type Provider = 'openrouter' | 'openai' | 'anthropic';

const PROVIDER_KEY_NAMES: Record<Provider, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  try {
    // -----------------------------------------------------------------------
    // Step 1 — Parse CLI flags
    // -----------------------------------------------------------------------
    const { values: rawValues } = parseArgs({
      args: process.argv.slice(2),
      options: {
        mode: { type: 'string', default: 'working' },
        provider: { type: 'string', default: 'openrouter' },
        model: { type: 'string', default: DEFAULT_MODEL },
        'fail-on': { type: 'string', default: 'critical' },
        verbose: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
    });

    const help = rawValues.help as boolean | undefined;
    if (help) {
      process.stdout.write(USAGE);
      process.exit(0);
    }

    const rawMode = (rawValues.mode ?? 'working') as string;
    if (!(DIFF_MODES as readonly string[]).includes(rawMode)) {
      process.stderr.write(
        `Unknown --mode "${rawMode}". Choose: ${DIFF_MODES.join(' | ')}\n`,
      );
      process.exit(2);
    }
    const mode = rawMode as DiffMode;

    const provider = (rawValues.provider ?? 'openrouter') as Provider;
    const model = (rawValues.model ?? DEFAULT_MODEL) as string;

    // Validate the gate policy loudly — an unrecognized value must never
    // silently disable the gate (the whole point of the CLI in CI/pre-push).
    const failOnParsed = CiFailOn.safeParse(rawValues['fail-on'] ?? 'critical');
    if (!failOnParsed.success) {
      process.stderr.write(
        `Unknown --fail-on "${rawValues['fail-on']}". Choose: critical | warning | any | never\n`,
      );
      process.exit(2);
    }
    const failOn = failOnParsed.data;

    const verbose = (rawValues.verbose ?? false) as boolean;

    // -----------------------------------------------------------------------
    // Step 2 — Resolve secrets + validate API key
    // -----------------------------------------------------------------------
    const secretsPath =
      process.env['DEVDIGEST_SECRETS_PATH'] ?? join(homedir(), '.devdigest', 'secrets.json');
    const secrets = new LocalSecretsProvider(secretsPath);

    const keyName = PROVIDER_KEY_NAMES[provider];
    if (!keyName) {
      process.stderr.write(
        `Unknown provider "${provider}". Choose: openrouter, openai, anthropic\n`,
      );
      process.exit(2);
    }

    const apiKey = await secrets.get(keyName);
    if (!apiKey) {
      process.stderr.write(
        `Missing API key for provider "${provider}".\n` +
          `Set the ${keyName} environment variable, or store it in:\n` +
          `  ${secretsPath}\n`,
      );
      process.exit(2);
    }

    // -----------------------------------------------------------------------
    // Step 3 — Instantiate LLM adapter
    // -----------------------------------------------------------------------
    let llm: LLMProvider;
    if (provider === 'openai') {
      llm = new OpenAIProvider(apiKey);
    } else if (provider === 'anthropic') {
      llm = new AnthropicProvider(apiKey);
    } else {
      // 'openrouter' (default) — imported from @devdigest/reviewer-core
      llm = new OpenRouterProvider(apiKey);
    }

    // -----------------------------------------------------------------------
    // Step 4 — Acquire the diff
    // -----------------------------------------------------------------------
    let rawDiff: string;
    try {
      rawDiff = await createDiffSource(mode, process.cwd()).acquire();
    } catch (err) {
      if (err instanceof GitNotARepoError) {
        process.stderr.write('Not a git repository. Run from inside a git repo.\n');
      } else {
        process.stderr.write(
          `Failed to acquire diff: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
      process.exit(2);
    }

    // -----------------------------------------------------------------------
    // Step 5 — Parse the diff; bail early on empty
    // -----------------------------------------------------------------------
    const unifiedDiff = parseUnifiedDiff(rawDiff);
    if (unifiedDiff.files.length === 0) {
      process.stdout.write('Nothing to review — diff is empty.\n');
      process.exit(0);
    }

    // -----------------------------------------------------------------------
    // Step 6 — SIGINT wiring
    // -----------------------------------------------------------------------
    let cancelled = false;
    process.on('SIGINT', () => {
      cancelled = true;
      process.stderr.write('\nCancellation requested — stopping after current chunk.\n');
    });

    // -----------------------------------------------------------------------
    // Step 7 — Run the reviewer
    // -----------------------------------------------------------------------
    process.stderr.write(
      `DevDigest pre-review: ${unifiedDiff.files.length} file(s) changed` +
        ` [provider=${provider}, model=${model}]\n`,
    );

    const outcome = await reviewPullRequest({
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      model,
      diff: unifiedDiff,
      llm,
      strategy: 'auto',
      task: 'Review working-copy changes before opening a PR',
      onEvent: (e) => process.stderr.write(`  [${e.kind}] ${e.msg}\n`),
      checkCancelled: () => {
        if (cancelled) throw new CliCancelledError();
      },
    });

    // -----------------------------------------------------------------------
    // Step 8 — Render findings + summary
    // -----------------------------------------------------------------------
    renderFindings(outcome.review.findings, { verbose });
    renderSummary({
      grounding: outcome.grounding,
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
      costUsd: outcome.costUsd,
    });

    process.exit(resolveExitCode(outcome.review.findings, failOn));
  } catch (err) {
    if (err instanceof Error && err.message.includes('No endpoints found')) {
      process.stderr.write(
        `\nModel unavailable: ${err.message}\n` +
          `Hint: pass --model <id> to override, or check available models at https://openrouter.ai/models\n`,
      );
      process.exit(2);
    }
    process.stderr.write(
      `\nError: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }
}
