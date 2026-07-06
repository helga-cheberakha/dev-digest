> **Superseded by** PLAN-pre-review-cli-bug-fix.md — the CLI now lives in mcp-server and is invoked as `devdigest review`. Do not execute this plan.

# Plan: Local Pre-Review CLI (`--mode working`)
> Status: SUPERSEDED
> Date: 2026-07-06
> Author: planner agent

## Overview

A new `pre-review` CLI command lets a developer run the exact same Structured Reviewer that
the DevDigest studio uses — against their local working-copy diff — before they even open a
pull request. The command captures `git diff` from the user's current repository, feeds it
to the existing `reviewPullRequest` pipeline in `@devdigest/reviewer-core`, and prints the
structured findings to the terminal with severity labels and an appropriate exit code.
No new logic is added to the reviewer; the CLI is a thin composition root that wires existing
adapters to the existing engine from a new entry point.

---

## Requirements → Task coverage

| Requirement | Task(s) |
|---|---|
| Capture local working-copy diff (`git diff`) | T1 |
| Mode flag `--mode working` (extensible enum, room for `staged`/`branch`) | T1, T3 |
| Reuse the exact `reviewPullRequest` pipeline from `reviewer-core` — no duplication | T3 |
| Feed diff to reviewer and get back structured findings | T3 |
| Print findings to terminal (severity / file / line / issue / fix) | T2 |
| Exit codes: non-zero on blocking findings, error code on failure | T3 |
| Configurable gate (`--fail-on critical\|warning\|any\|never`) | T2, T3 |
| API key / LLM provider resolution outside the server process | T3 |
| Error handling: empty diff, not a git repo, LLM failure | T3 |
| Tests covering core logic | T4 |

*(Every row maps to at least one task. No gaps.)*

---

## Scope

### Modules affected
- [x] server — new `src/cli/` tree (diff adapter, renderer, entry point); `package.json` gains one script; no Fastify routes, no DB, no migrations
- [ ] client — no changes
- [ ] reviewer-core — no changes (consumed unchanged)
- [ ] e2e — no new e2e tests (CLI is not a browser flow)

### Explicitly out of scope
- `--mode staged` and `--mode branch` implementation (design the abstraction to accept them; defer implementation)
- DB-backed agent config lookup (CLI uses a built-in default system prompt; no DB connection)
- Repo-intel context enrichment in the CLI path (callers, repoMap, fileRank all require a DevDigest-managed clone; omitted → those prompt sections are simply absent)
- Changes to any existing Fastify route, module, or migration
- Publishing the CLI as an npm bin / global install (out of scope; run via `tsx` / `npm run pre-review`)

---

## Engineering Insights from Codebase

Pulled from INSIGHTS.md files — these are load-bearing constraints, not suggestions.

### server
- `LocalSecretsProvider` reads JSON overrides first, then falls back to `process.env` for any key — including `OPENROUTER_API_KEY` which is typed as `(string & {})`. The CLI can instantiate it with the same secrets-file path the server uses, giving the user's stored keys for free. Evidence: `server/src/adapters/secrets/local.ts`.
- Relative imports carry the `.js` extension (ESM). All new `src/cli/` files must use `.js` in import specifiers even though the source files are `.ts`. Evidence: all existing server modules follow this pattern.
- `parseUnifiedDiff` in `server/src/adapters/git/diff-parser.ts` returns `UnifiedDiff` — exactly the type `ReviewInput.diff` expects. No new parsing needed.
- `OpenRouterProvider` lives in `@devdigest/reviewer-core` (not in server adapters), so the CLI can import it from there directly (the path alias `@devdigest/reviewer-core` is available inside the server's tsconfig). Evidence: `server/src/platform/container.ts:22`.

### client
- No relevant insights for this feature.

### reviewer-core
- `reviewPullRequest` returns `ReviewOutcome` which includes `review.findings`, `grounding`, `tokensIn`, `tokensOut`, and `costUsd`. The CLI should use `costUsd` from the outcome directly rather than recomputing. Evidence: `reviewer-core/src/review/run.ts:98-116`.
- `reviewer-core` AGENTS.md iron rule: no I/O. The CLI must not add any I/O to reviewer-core; all git calls and stdout writes stay in the server's CLI layer. Evidence: `reviewer-core/AGENTS.md`.
- `onEvent` callback is the only progress mechanism — the CLI can forward these to stderr so stdout stays machine-parseable. Evidence: `ReviewInput.onEvent` in `run.ts:89`.
- `checkCancelled` should be wired so `Ctrl-C` (SIGINT) stops the run cleanly between map-reduce chunks. Evidence: `ReviewInput.checkCancelled` in `run.ts:91-95`.

### e2e
- No relevant insights.

---

## Implementation Tasks

---

### T1: Diff acquisition abstraction  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | none |
| **Parallel with** | T2 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/src/cli/diff-source.ts` | create | `DiffSource` port interface + `createDiffSource` factory |
| `server/src/cli/diff-sources/working.ts` | create | `WorkingTreeDiffSource` adapter — runs `git diff` in `cwd` |

**Approach**

1. In `diff-source.ts`, declare a `DiffMode` string-union type: `'working' | 'staged' | 'branch'`. Only `'working'` needs a concrete implementation now; the others are reserved in the type for future modes.
2. Declare the `DiffSource` port interface with a single method `acquire(): Promise<string>` that returns the raw unified-diff text. This is the port; the CLI composition root depends on this interface only.
3. Declare `createDiffSource(mode: DiffMode, cwd: string): DiffSource` as the factory. For `'working'`, return a `WorkingTreeDiffSource`. For `'staged'` and `'branch'`, throw a descriptive `Error` (`DiffMode "${mode}" is not yet implemented`). This makes future extension trivial — implement the class, wire it in the factory.
4. In `diff-sources/working.ts`, implement `WorkingTreeDiffSource` which calls `execFile('git', ['diff'], { cwd })` using Node's built-in `node:child_process` `execFile` wrapped in a `promisify` — no new dependencies. Use `execFile` not `exec` (avoids shell injection, consistent with the security skill's command-injection guidance).
5. Detect two error conditions and rethrow with clean messages:
   - If `git diff` exits non-zero with a message containing "not a git repository" → throw `GitNotARepoError` (a subclass of `Error` with a `code: 'not_a_repo'` field so the CLI entry point can render a specific user-facing message).
   - If `git diff` exits non-zero for any other reason → throw `GitDiffError` wrapping the stderr text.
6. Return the raw stdout string from `acquire()`. The caller (`pre-review.ts`) is responsible for passing it to `parseUnifiedDiff`.
7. Use `.js` extension in all relative imports (ESM rule).

**Tests**

- Existing tests that must stay green: all 162 server tests (none touch `src/cli/`)
- New tests to write (T4 covers these): `acquire()` success, `not_a_repo` error, non-zero exit error

**Definition of done**
- [ ] TypeScript compiles with zero errors in `server/`
- [ ] `WorkingTreeDiffSource` implements `DiffSource` interface
- [ ] `createDiffSource('staged', cwd)` throws a descriptive "not yet implemented" error
- [ ] `GitNotARepoError` has a `code: 'not_a_repo'` field distinguishable from other errors

---

### T2: Terminal output renderer  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | none |
| **Parallel with** | T1 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/src/cli/output.ts` | create | Renders findings + summary to stdout; determines exit code |

**Approach**

1. Import `Finding` and `Severity` from `@devdigest/shared` (the canonical Zod-inferred type). Do NOT import from `src/vendor/shared/` directly; use the path alias `@devdigest/shared` that the server tsconfig already resolves correctly.
2. Define a `SeverityLevel` ranking map consistent with the project's existing `SEV_RANK` in `reviewer-core/src/output/to-review.ts`: `CRITICAL=3`, `WARNING=2` (the contract uses `WARNING` not `HIGH`), `SUGGESTION=1`. Note: the contract's `Severity` enum is `'CRITICAL' | 'WARNING' | 'SUGGESTION'` — not `HIGH/MEDIUM/LOW`. Terminal labels should match the contract enum exactly to avoid confusion.
3. Implement `renderFindings(findings: Finding[], opts: { verbose?: boolean }): void` that writes to stdout:
   - A header line: `DevDigest Pre-Review — N finding(s)`
   - For each finding, grouped and sorted CRITICAL → WARNING → SUGGESTION:
     - Severity label with a printable prefix (e.g. `[CRITICAL]`, `[WARNING]`, `[SUGGESTION]`)
     - `file:start_line` location
     - `title` on one line
     - `rationale` indented (truncated to ~300 chars in non-verbose mode)
     - `suggestion` if present, indented and prefixed with "Fix:"
   - A summary line at the end: `N critical · N warning · N suggestion`
4. Implement `renderSummary(outcome: { grounding: string; tokensIn: number; tokensOut: number; costUsd: number | null }): void` that writes a compact cost/grounding line to stderr (keep stdout clean for piping).
5. Implement `resolveExitCode(findings: Finding[], failOn: FailOnPolicy): number`:
   - `FailOnPolicy` type alias: `'critical' | 'warning' | 'any' | 'never'`
   - Returns `0` when no findings trip the gate
   - Returns `1` when at least one finding trips the gate (non-zero → blocking)
   - The `never` policy always returns `0`
   - Reuse the same rank comparison logic as `gateTriggered` in `reviewer-core/src/output/to-review.ts` (do not import from that file — reimplement the tiny rank comparison inline or copy the constant, because `to-review.ts` is in `reviewer-core` and the CLI's output module lives in server; a server→reviewer-core import is fine via path alias, but this function is purely about exit codes — keep it co-located with the renderer)
6. Export all three functions. No default export (named exports are the server convention).
7. Write zero dependencies beyond Node built-ins and `@devdigest/shared`.

**Tests**

- Existing tests that must stay green: all 162 server tests
- New tests to write (T4): `resolveExitCode` with each `FailOnPolicy`, `renderFindings` output structure (capture stdout)

**Definition of done**
- [ ] TypeScript compiles with zero errors
- [ ] `resolveExitCode` correctly maps each `FailOnPolicy` to exit code 0 or 1
- [ ] Output format matches severity levels from the `Severity` Zod enum (`CRITICAL`/`WARNING`/`SUGGESTION`)

---

### T3: CLI entry point + package.json script  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | T1, T2 |
| **Parallel with** | none |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/src/cli/pre-review.ts` | create | Main CLI entry point (composition root) |
| `server/package.json` | edit | Add `"pre-review"` script |

**Approach**

1. `pre-review.ts` is the composition root. It is the only file that imports both a port and its concrete adapter. Following the onion-architecture rule, it sits in the outermost ring and is the ONLY place allowed to do so.
2. Parse CLI flags with Node's built-in `node:util` `parseArgs`. Flags:
   - `--mode working` (default `'working'`; parsed as `DiffMode`)
   - `--provider openrouter|openai|anthropic` (default `'openrouter'`)
   - `--model <id>` (default `'deepseek/deepseek-r1-distill-qwen-32b'` — cheap and available via OpenRouter; override-able so the user can pick any model their provider supports)
   - `--fail-on critical|warning|any|never` (default `'critical'`)
   - `--verbose` boolean flag (passes through to `renderFindings`)
   - `--help` / `-h` prints usage and exits 0
3. Resolve the LLM provider: instantiate `LocalSecretsProvider` pointing to the server's configured secrets path (derive from `process.env.DEVDIGEST_SECRETS_PATH` if set, or fall back to a known default path `~/.devdigest/secrets.json`). Then call `secrets.get('OPENROUTER_API_KEY')` (or the appropriate key for the chosen provider). If the key is missing, print a clear message telling the user which env var to set and exit with code 2.
4. Instantiate the correct LLM adapter:
   - `openrouter` → `new OpenRouterProvider(key)` (imported from `@devdigest/reviewer-core`)
   - `openai` → `new OpenAIProvider(key)` (imported from `server/src/adapters/llm/openai.js`)
   - `anthropic` → `new AnthropicProvider(key)` (imported from `server/src/adapters/llm/anthropic.js`)
5. Capture the diff: call `createDiffSource(mode, process.cwd()).acquire()`. Wrap in try/catch:
   - `GitNotARepoError` → print "Not a git repository. Run from inside a git repo." and exit 2
   - Any other error → print the error message and exit 2
6. Parse the diff: `const unifiedDiff = parseUnifiedDiff(rawDiff)`. If `unifiedDiff.files.length === 0`, print "Nothing to review — diff is empty." and exit 0 (clean exit, not an error).
7. Install a SIGINT handler that sets a `cancelled` flag. Wire `checkCancelled: () => { if (cancelled) throw new CancelledError(); }` into `ReviewInput`.
8. Set a reasonable built-in default system prompt. It should be a code-review-focused system prompt string that mirrors the starter agent in the studio. Define it as a `const DEFAULT_SYSTEM_PROMPT` at the top of the file. This prompt is the only thing that can't be pulled from the DB (the CLI has no DB). Future work: `--system-prompt-file <path>` flag.
9. Call `reviewPullRequest` with:
   - `systemPrompt`: `DEFAULT_SYSTEM_PROMPT`
   - `model`: from `--model` flag
   - `diff`: the parsed `UnifiedDiff`
   - `llm`: the resolved provider instance
   - `strategy: 'auto'`
   - `task: 'Review working-copy changes before opening a PR'`
   - `onEvent: (e) => process.stderr.write(e.msg + '\n')` — progress to stderr, not stdout
   - `checkCancelled`: SIGINT-wired function from step 7
   - All other optional fields (`skills`, `memory`, `specs`, `callers`, `repoMap`, `intent`) are omitted — these require DB/repo-intel context the CLI doesn't have
10. After `reviewPullRequest` returns:
    - Call `renderFindings(outcome.review.findings, { verbose })` to stdout
    - Call `renderSummary({ grounding, tokensIn, tokensOut, costUsd })` to stderr
    - Call `process.exit(resolveExitCode(outcome.review.findings, failOn))`
11. Wrap the entire `main()` body in a top-level try/catch. On any unhandled error, print the message to stderr and exit 2.
12. In `server/package.json`, add to `"scripts"`:
    ```
    "pre-review": "tsx src/cli/pre-review.ts"
    ```
    Usage: `npm run pre-review -- --mode working`
13. Verify the `tsconfig.json` in `server/` already has `@devdigest/reviewer-core` and `@devdigest/shared` path aliases (they do — confirmed from container.ts imports). No tsconfig changes needed.

**Tests**

- Existing tests that must stay green: all 162 server tests
- New tests to write (T4): integration test with mock LLM

**Definition of done**
- [ ] TypeScript compiles with zero errors (`npx tsc --noEmit` inside `server/`)
- [ ] Running `npm run pre-review -- --mode working` in a git repo with changes captures the diff and invokes `reviewPullRequest`
- [ ] Running it outside a git repo exits with code 2 and a friendly message
- [ ] Running it with an empty diff (no uncommitted changes) exits with code 0 and "Nothing to review"
- [ ] `--help` prints usage and exits 0

---

### T4: Tests  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | T1, T2, T3 |
| **Parallel with** | none |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/src/cli/diff-source.test.ts` | create | Unit tests for `WorkingTreeDiffSource` and `createDiffSource` |
| `server/src/cli/output.test.ts` | create | Unit tests for `resolveExitCode` and `renderFindings` |
| `server/src/cli/pre-review.test.ts` | create | Integration test: mock LLM → full pipeline → exit code |

**Approach**

1. `diff-source.test.ts`:
   - Mock `node:child_process` `execFile` with `vi.mock`. Test the success path (returns raw diff string), the `not_a_repo` path (exit 1 + stderr "not a git repository" → `GitNotARepoError` with `code: 'not_a_repo'`), and a generic non-zero exit path.
   - Test `createDiffSource('staged', cwd)` throws "not yet implemented".
   - Use `vitest` (already the server's test runner). No database, no Fastify, no container needed.

2. `output.test.ts`:
   - Test `resolveExitCode` with each `FailOnPolicy` (`critical`, `warning`, `any`, `never`) against a mix of severities, asserting correct 0/1 results.
   - Test `renderFindings` by redirecting stdout capture (via `vi.spyOn(process.stdout, 'write')`) and asserting the output contains each finding's title, severity label, and file:line.
   - Test the empty-findings path outputs the "No findings" message.

3. `pre-review.test.ts`:
   - Build a mock `LLMProvider` that returns a canned `Review` with one `CRITICAL` finding. This mirrors the pattern used in `server/test/blast-route.test.ts` — inject via the adapter pattern.
   - Test the full pipeline: construct `WorkingTreeDiffSource` with a temp directory that has a real git repo and uncommitted changes (use `node:os` `tmpdir` + `child_process.execSync` to `git init`, stage a file, etc.), then call the composed chain (diff acquire → parse → reviewPullRequest mock → exit code).
   - Alternatively (simpler): test the pipeline by calling the individual units directly with a hardcoded raw-diff string, bypassing the actual `git` call. This avoids creating a real git repo in tests.
   - Assert: when the mock LLM returns a `CRITICAL` finding and `--fail-on critical`, `resolveExitCode` returns 1.
   - Assert: when the mock LLM returns no findings, `resolveExitCode` returns 0.

**Tests**

- Existing tests that must stay green: all 162 server tests (`vitest run` in `server/`)
- New tests: diff-source (3 cases), output (6 cases), integration (2 cases)

**Definition of done**
- [ ] `npm run test` in `server/` passes with all existing + new tests green
- [ ] TypeScript compiles with zero errors
- [ ] `resolveExitCode` unit tests cover all four `FailOnPolicy` values

---

## Parallelisation map

```
T1 ──► T3
T2 ──► T3
            T3 ──► T4
```

T1 (diff abstraction) and T2 (output renderer) can run in parallel — they share no files.
T3 (CLI entry point) depends on both T1 and T2 completing first (it imports from both).
T4 (tests) depends on T1, T2, and T3 all being present before writing tests against them.

**File conflict check (must be clean before Status: READY)**

| File | Assigned to | Parallel tasks | Conflict? |
|---|---|---|---|
| `server/src/cli/diff-source.ts` | T1 | T2 | No — T2 touches only `output.ts` |
| `server/src/cli/diff-sources/working.ts` | T1 | T2 | No |
| `server/src/cli/output.ts` | T2 | T1 | No — T1 touches only `diff-source.ts` |
| `server/src/cli/pre-review.ts` | T3 | none (T3 is sequential) | No conflict |
| `server/package.json` | T3 | none (T3 is sequential) | No conflict |
| `server/src/cli/diff-source.test.ts` | T4 | none (T4 is sequential) | No conflict |
| `server/src/cli/output.test.ts` | T4 | none | No conflict |
| `server/src/cli/pre-review.test.ts` | T4 | none | No conflict |

All clean — no unresolved conflicts.

---

## Risks

- **Default system prompt quality**: The CLI has no DB, so it cannot fetch an agent's configured system prompt. The built-in `DEFAULT_SYSTEM_PROMPT` must be good enough for a standalone "pre-review" use case, but it will not match the studio agent's prompt unless the user manually edits the constant or a future flag (`--system-prompt-file`) is added. Discovered but not in scope — document in the CLI's `--help` output.
- **`OPENROUTER_API_KEY` not in `SecretKey` union**: The `SecretKey` type uses `(string & {})` as an open union; `LocalSecretsProvider.get()` resolves any string key against `process.env`, so `'OPENROUTER_API_KEY'` works without a type change. However, if someone adds a strict-union refinement in the future, this will break. Low risk.
- **`simple-git` dependency not used**: The CLI spawns `git diff` directly via `execFile` rather than going through `SimpleGitClient`. This is correct (the CLI runs in the user's own repo, not a DevDigest-managed clone), but it means the CLI's diff logic is NOT exercising the `GitClient` port — it's a new infrastructure path. Future `--mode branch` may want to reuse `SimpleGitClient`; plan for that abstraction to grow.
- **Exit code collision**: Using code `1` for "blocking findings" and `2` for "runtime errors" is conventional but not enforced by any test today. If a future mode adds a third category, care must be taken not to collide.
- **Reviewer-core `onEvent` logs to stderr**: If a downstream tool pipes only stdout, the progress log disappears silently. This is the correct behavior for a CLI (stderr = diagnostics, stdout = result) but may surprise users. Document in `--help`.
- **Large working-copy diffs**: `git diff` on a large repo with many unstaged changes could produce a multi-megabyte diff that taxes the LLM context window. The auto strategy in `reviewPullRequest` will trigger map-reduce when lines exceed the threshold (400 by default), but this may still be slow or expensive. Recommend documenting a `--strategy single-pass` flag as future work.

---

## Global definition of done
- [ ] All existing tests pass across all touched modules (`npm run test` inside `server/`)
- [ ] TypeScript compiles with zero errors inside `server/` (`npm run typecheck`)
- [ ] Requirements → Task coverage table is complete (no uncovered rows) — verified above
- [ ] File conflict check table shows no unresolved conflicts — verified above
- [ ] Plan marked `Status: READY`
