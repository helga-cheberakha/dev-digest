# Plan: Pre-review CLI — relocate to mcp-server, fix stale model, improve error UX
> Status: READY
> Date: 2026-07-06
> Author: planner agent

> **Supersedes** the initial two-task draft of this same plan (T1 model-id fix, T2 404
> hint). Those fixes are now re-homed into T3 of this revised plan which adds the
> relocation of the CLI to the mcp-server package.

## Overview

The local pre-review CLI currently lives in `server/src/cli/` and is invoked via
`npm run pre-review -- [options]`. The new requirement is to make it a first-class
`devdigest` bin command invocable as `devdigest review --mode working` from any git
repository directory, without a running API server. The CLI moves to the `mcp-server`
package, wired offline the same way it is today (git diff → parseUnifiedDiff →
reviewPullRequest). The move also folds in the stale `DEFAULT_MODEL` bug fix
(`deepseek-r1-distill-qwen-32b` → `deepseek/deepseek-v4-flash`) and an actionable
error hint for the OpenRouter 404 "No endpoints found" case.

## Requirements → Task coverage

| Requirement | Task(s) |
|---|---|
| Invocable as `devdigest review --mode working` from any git repo dir | T3, T4 |
| No running API server required (offline, in-process wiring) | T3 (composition root unchanged) |
| `devdigest` bare or unknown subcommand prints usage and exits 2 | T4 |
| Fix `DEFAULT_MODEL` from `deepseek-r1-distill-qwen-32b` to `deepseek/deepseek-v4-flash` | T3 |
| Actionable error hint when OpenRouter returns 404 "No endpoints found" | T3 |
| Flags unchanged: --mode, --provider, --model, --fail-on, --verbose, --help | T3 |
| mcp-server typechecks with zero errors | T1, T2, T3, T4 |
| mcp-server test suite green (14 relocated tests) | T5 |
| server test suite stays green at its previous baseline (176 → 162 after CLI removal) | T6 |
| PLAN-local-pre-review-cli.md updated with a superseded note | T7 |

## Scope

### Modules affected
- [x] mcp-server — new `src/cli/` tree, new `bin/devdigest` entrypoint, updated `package.json` + `tsconfig.json`, new `vitest.config.ts`
- [x] server — delete `src/cli/` directory; remove `pre-review` npm script from `package.json`
- [ ] client — not touched
- [ ] reviewer-core — not touched
- [ ] e2e — not touched

### Explicitly out of scope
- `staged` and `branch` diff modes (still throw "not yet implemented" — unchanged from original)
- Publishing to npm or a global package registry
- Adding a `devdigest` subcommand for any feature other than `review`
- The npm `npm_config_*` swallowed-flag warning from the earlier draft — this is moot because the `devdigest` bin is invoked directly (not via `npm run`), so npm never processes the flags
- Any change to `reviewer-core`, `client`, or the server's Fastify modules

---

## Engineering Insights from Codebase

### server
- **tsx tsconfig resolution (2026-07-06):** tsx resolves `@devdigest/*` path aliases from the tsconfig at the CWD. The `devdigest` bin must pass `--tsconfig <absolute-path>` so alias resolution works when invoked from any arbitrary directory — the user runs `devdigest` from the repo they are reviewing, not from `mcp-server/`. Evidence: `server/INSIGHTS.md` (2026-07-06).
- **CLI as composition root (2026-07-06):** `src/cli/pre-review.ts` is the ONLY place allowed to know both a port and its concrete adapter (onion-architecture composition-root rule). After relocation, `mcp-server/src/cli/review.ts` inherits this role. Evidence: same insight entry.
- **Grounding gate fixture constraint (2026-07-06):** Tests feeding a canned `Review` through `MockLLMProvider` into `reviewPullRequest` must have findings whose `file` and `start_line` land inside a real hunk — the grounding gate silently drops findings that miss. Do not alter the test fixture when relocating the test. Evidence: `server/INSIGHTS.md` (Recurring Errors, 2026-07-06).
- **DEFAULT_MODEL stale (2026-07-06, bug being fixed):** `deepseek/deepseek-r1-distill-qwen-32b` yields OpenRouter 404 "No endpoints found". `deepseek/deepseek-v4-flash` is the codebase standard. The old slug has no pricing entry; the new one does. Evidence: `server/src/db/seed.ts:14`, `server/src/adapters/llm/pricing.ts:31`.

### mcp-server
- **Already aliases `@devdigest/shared`** via tsconfig `paths` (`../server/src/vendor/shared/index.ts`). The same wildcard pattern can extend to reviewer-core and server adapters. Evidence: `mcp-server/tsconfig.json`.
- **No test setup yet** — no `vitest` devDep, no test script, no `vitest.config.ts`. Must be bootstrapped in T1. The server's `vitest.config.ts` shows the required pattern: `resolve.alias` for path aliases + `test.environment: 'node'`. Evidence: `mcp-server/package.json`, `server/vitest.config.ts`.
- **No `bin` field** in `mcp-server/package.json` yet. Evidence: `mcp-server/package.json`.

### reviewer-core / e2e
- `reviewer-core/src/index.ts` exports `reviewPullRequest`, `OpenRouterProvider`, and the `ReviewInput`/`ReviewOutcome` types needed by the CLI. Consumers wire it via tsconfig path alias (`@devdigest/reviewer-core` → `../reviewer-core/src`) — documented in the package header. Evidence: `reviewer-core/src/index.ts:1-60`.
- No e2e changes.

---

## Implementation Tasks

---

### T1: mcp-server package bootstrap  `MODULE: mcp-server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | none |
| **Parallel with** | T7 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `mcp-server/package.json` | edit | add `openai` + `@anthropic-ai/sdk` deps; add `vitest` devDep; add `test` script; add `bin` field |
| `mcp-server/tsconfig.json` | edit | add `@devdigest/reviewer-core` + `@devdigest/reviewer-core/*` + `@devdigest/server/adapters/*` path aliases |
| `mcp-server/vitest.config.ts` | create | vitest needs its own alias map (does not read tsconfig paths automatically) |

**Approach**

1. In `mcp-server/package.json`, add to `dependencies`: `"openai": "^4.77.0"` and `"@anthropic-ai/sdk": "^0.33.1"` (same major versions as `server/package.json`). Add to `devDependencies`: `"vitest": "^2.1.8"` (same version as server). Add script `"test": "vitest run"`. Add `"bin": {"devdigest": "bin/devdigest"}` at the package top level. Run `npm install` in `mcp-server/` after editing.

2. In `mcp-server/tsconfig.json`, extend the existing `paths` block with three new entries:
   - `"@devdigest/reviewer-core": ["../reviewer-core/src/index.ts"]`
   - `"@devdigest/reviewer-core/*": ["../reviewer-core/src/*"]`
   - `"@devdigest/server/adapters/*": ["../server/src/adapters/*"]`

   The `/*` wildcard entries are required for deep imports: `@devdigest/reviewer-core/output/to-review.js` (used by `output.ts`) and `@devdigest/server/adapters/mocks.js` (used by tests).

3. Create `mcp-server/vitest.config.ts` modeled directly on `server/vitest.config.ts`. Define `resolve.alias` for:
   - `@devdigest/shared` → `path.resolve(__dirname, '../server/src/vendor/shared')`
   - `@devdigest/reviewer-core` → `path.resolve(__dirname, '../reviewer-core/src')`
   - `@devdigest/server/adapters` → `path.resolve(__dirname, '../server/src/adapters')`

   Set `test.environment: 'node'`, `test.globals: true`, and `test.include: ['src/**/*.test.ts']`. No testTimeout override needed (all tests are pure in-process, no Postgres).

**Tests**

- Infrastructure task; no tests in this task.
- Verify: `cd mcp-server && npx tsc --noEmit` compiles cleanly after the tsconfig edit.

**Definition of done**
- [ ] `mcp-server/package.json` has `bin`, `openai`, `@anthropic-ai/sdk`, `vitest`, and `test` script
- [ ] `mcp-server/tsconfig.json` has the three new path alias entries
- [ ] `mcp-server/vitest.config.ts` exists and mirrors the server pattern
- [ ] `cd mcp-server && npx tsc --noEmit` exits 0

---

### T2: Relocate diff-source and output modules  `MODULE: mcp-server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | T1 |
| **Parallel with** | T3, T4 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `mcp-server/src/cli/diff-source.ts` | create | relocated from `server/src/cli/diff-source.ts` |
| `mcp-server/src/cli/diff-sources/working.ts` | create | relocated from `server/src/cli/diff-sources/working.ts` |
| `mcp-server/src/cli/output.ts` | create | relocated from `server/src/cli/output.ts` |

**Approach**

1. Copy `server/src/cli/diff-source.ts` verbatim to `mcp-server/src/cli/diff-source.ts`. The file only imports from `./diff-sources/working.js` (relative) — no cross-package import changes needed.

2. Copy `server/src/cli/diff-sources/working.ts` verbatim to `mcp-server/src/cli/diff-sources/working.ts`. All imports are Node built-ins or relative (`../diff-source.js`) — unchanged.

3. Copy `server/src/cli/output.ts` verbatim to `mcp-server/src/cli/output.ts`. Its imports are:
   - `@devdigest/shared` — already aliased in T1, no change
   - `@devdigest/reviewer-core` — now aliased via T1, import string is unchanged
   - `@devdigest/reviewer-core/output/to-review.js` — covered by the `@devdigest/reviewer-core/*` wildcard alias from T1, import string is unchanged

   No edits to the file body are required.

**Tests**

- Existing server tests for these files remain in server until T5.

**Definition of done**
- [ ] Three files created in `mcp-server/src/cli/`; content matches server originals (zero functional diff)
- [ ] `cd mcp-server && npx tsc --noEmit` exits 0

---

### T3: Create the `review` command  `MODULE: mcp-server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | T1 |
| **Parallel with** | T2, T4 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `mcp-server/src/cli/review.ts` | create | relocated + adapted composition root; folds in the model fix and 404 hint |

**Approach**

1. Start from `server/src/cli/pre-review.ts` as the base. This is the composition root for the review pipeline and the only place allowed to know both a port and its concrete adapter.

2. **Fix DEFAULT_MODEL (original T1):** Change the constant value from `'deepseek/deepseek-r1-distill-qwen-32b'` to `'deepseek/deepseek-v4-flash'`. Add an inline comment: `// Keep in sync with seed.ts DEFAULT_MODEL and FEATURE_MODELS in platform.ts`. The USAGE string and `parseArgs` default both embed `${DEFAULT_MODEL}` as a template expression and update automatically.

3. **Update all cross-package import paths** to use the new tsconfig aliases added in T1:
   - `from '../adapters/git/diff-parser.js'` → `from '@devdigest/server/adapters/git/diff-parser.js'`
   - `from '../adapters/secrets/local.js'` → `from '@devdigest/server/adapters/secrets/local.js'`
   - `from '../adapters/llm/openai.js'` → `from '@devdigest/server/adapters/llm/openai.js'`
   - `from '../adapters/llm/anthropic.js'` → `from '@devdigest/server/adapters/llm/anthropic.js'`
   - Local relative imports (`./diff-source.js`, `./output.js`) stay unchanged.
   - `@devdigest/reviewer-core` and `@devdigest/shared` import strings are unchanged.

4. **Drop the npm swallowed-flag warning.** The `devdigest` bin is invoked directly, not via `npm run`, so `npm_config_*` env vars are never set. Do not add that detection block.

5. **Add OpenRouter 404 error hint (original T2):** In the outer `catch(err)` block, before the generic `Error: ${err.message}` fallback, check whether `err` is an `Error` instance and `err.message` includes the substring `'No endpoints found'`. If it does, write to stderr:
   ```
   Model unavailable: <original error message>
   Hint: pass --model <id> to override, or check available models at https://openrouter.ai/models
   ```
   The original error message from OpenRouter already includes the offending model slug — no variable hoisting is needed. All other errors fall through to the generic message. Exit code remains 2 in both cases.

6. The file is named `review.ts` (not `pre-review.ts`) to match the `devdigest review` subcommand. The `main()` function must be exported (`export async function main(): Promise<void>`) rather than called as a side effect, so that `index.ts` (T4) can call it explicitly after stripping the subcommand from argv.

**Tests**

- Existing `server/src/cli/pre-review.test.ts` remains in server until T5. The model string `'gpt-4'` used in mock fixtures is hardcoded and unaffected by the `DEFAULT_MODEL` change.

**Definition of done**
- [ ] `mcp-server/src/cli/review.ts` exists
- [ ] `grep 'deepseek-r1-distill' mcp-server/src/cli/review.ts` returns zero matches
- [ ] `grep 'deepseek-v4-flash' mcp-server/src/cli/review.ts` returns the constant
- [ ] `grep 'No endpoints found' mcp-server/src/cli/review.ts` returns the catch-block detection
- [ ] `cd mcp-server && npx tsc --noEmit` exits 0

---

### T4: Create the `devdigest` bin entrypoint  `MODULE: mcp-server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | T1 |
| **Parallel with** | T2, T3 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `mcp-server/src/cli/index.ts` | create | subcommand dispatcher; entry point called by the bin |
| `mcp-server/bin/devdigest` | create | shell script; resolves its own directory and invokes tsx with explicit tsconfig |

**Approach**

1. Create `mcp-server/src/cli/index.ts`. This file reads `process.argv[2]` (the subcommand):
   - If `'review'`: remove `process.argv[2]` from the array (splice) so `review.ts`'s `parseArgs` sees only the flags. Then call `(await import('./review.js')).main()`.
   - If `undefined`, `'--help'`, or `'-h'`: write a global USAGE string to stdout, exit 0. The global USAGE should list `review` as the only subcommand and direct users to `devdigest review --help` for per-command flags.
   - Any other value: write `Unknown command: "${subcommand}"\n` plus the global USAGE to stderr, exit 2.

2. Create `mcp-server/bin/devdigest` as a bash shell script marked executable. The script must:
   - Resolve its own absolute directory: `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`.
   - Invoke tsx from the local `node_modules`: `"$SCRIPT_DIR/../node_modules/.bin/tsx"`.
   - Pass `--tsconfig "$SCRIPT_DIR/../tsconfig.json"` so path aliases resolve regardless of the caller's CWD.
   - Pass `"$SCRIPT_DIR/../src/cli/index.ts"` as the entry point.
   - Forward all arguments: `"$@"`.
   - Use `exec` to replace the shell process (cleaner exit code propagation).

3. After `npm link` in `mcp-server/` (or `npm install -g`), the `devdigest` bin is available system-wide. `devdigest review --help` must print the review USAGE and exit 0. `devdigest` (no args) must print global usage and exit 0. `devdigest unknown` must print an error and exit 2.

**Tests**

- No automated tests for the dispatcher or bin script; wiring is exercised manually in the DoD.

**Definition of done**
- [ ] `mcp-server/bin/devdigest` exists, is executable (`chmod +x`), resolves tsx from local node_modules, passes `--tsconfig`
- [ ] `mcp-server/src/cli/index.ts` dispatches `review` / unknown / bare correctly
- [ ] After `cd mcp-server && npm link`: `devdigest --help` exits 0, `devdigest review --help` exits 0, `devdigest unknown-command` exits 2
- [ ] `cd mcp-server && npx tsc --noEmit` exits 0

---

### T5: Relocate tests to mcp-server  `MODULE: mcp-server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | T2, T3 |
| **Parallel with** | none |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `mcp-server/src/cli/diff-source.test.ts` | create | relocated from `server/src/cli/diff-source.test.ts` |
| `mcp-server/src/cli/output.test.ts` | create | relocated from `server/src/cli/output.test.ts` |
| `mcp-server/src/cli/review.test.ts` | create | relocated from `server/src/cli/pre-review.test.ts`; renamed to match `review.ts` |

**Approach**

1. Copy `server/src/cli/diff-source.test.ts` verbatim to `mcp-server/src/cli/diff-source.test.ts`. No import changes needed — all imports are `vitest`, Node built-ins, or relative (`./diff-source.js`).

2. Copy `server/src/cli/output.test.ts` verbatim to `mcp-server/src/cli/output.test.ts`. No import changes — imports are `vitest`, `@devdigest/shared` (aliased), and relative `./output.js`.

3. Copy `server/src/cli/pre-review.test.ts` to `mcp-server/src/cli/review.test.ts`. Update these two imports:
   - `from '../adapters/git/diff-parser.js'` → `from '@devdigest/server/adapters/git/diff-parser.js'`
   - `from '../adapters/mocks.js'` → `from '@devdigest/server/adapters/mocks.js'`
   - `from './output.js'` — unchanged (relative, still correct)

   Do NOT alter the `MockLLMProvider` fixture values, `RAW_DIFF`, or `CRITICAL_REVIEW` — the grounding gate requires the specific `file`/`start_line` combination already crafted in those fixtures. The `model: 'gpt-4'` value in the fixture is a mock string and is unaffected by the `DEFAULT_MODEL` change.

4. Run `cd mcp-server && npm test` to confirm all 14 tests pass. The `vitest.config.ts` created in T1 must define the `@devdigest/server/adapters` alias so `mocks.ts` (which itself imports from `./git/diff-parser.js` and `@devdigest/shared`) resolves correctly.

**Tests**

- `cd mcp-server && npm test` must exit 0 with 14 tests passing.

**Definition of done**
- [ ] Three new test files in `mcp-server/src/cli/`
- [ ] `cd mcp-server && npm test` exits 0 with 14 tests passing
- [ ] `cd mcp-server && npx tsc --noEmit` exits 0

---

### T6: Remove server/src/cli/ and clean up server  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | T5 |
| **Parallel with** | none |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/src/cli/pre-review.ts` | delete | moved to mcp-server |
| `server/src/cli/pre-review.test.ts` | delete | moved to mcp-server |
| `server/src/cli/diff-source.ts` | delete | moved to mcp-server |
| `server/src/cli/diff-source.test.ts` | delete | moved to mcp-server |
| `server/src/cli/diff-sources/working.ts` | delete | moved to mcp-server |
| `server/src/cli/output.ts` | delete | moved to mcp-server |
| `server/src/cli/output.test.ts` | delete | moved to mcp-server |
| `server/package.json` | edit | remove `"pre-review": "tsx src/cli/pre-review.ts"` from scripts |

**Approach**

1. Verify no remaining file in `server/src/` imports from `server/src/cli/`. Run `grep -r "from.*src/cli" server/src/ server/test/` — result must be empty before deleting.

2. Delete all seven files listed above and remove the now-empty `server/src/cli/` directory tree.

3. In `server/package.json`, remove the `"pre-review"` key from the `"scripts"` block.

4. Run `cd server && npx tsc --noEmit` to confirm the server compiles cleanly.

5. Run `cd server && npm test` to confirm the server test count is now the pre-CLI baseline minus 14. All remaining tests must be green.

**Tests**

- `cd server && npm test` must exit 0 with the server's prior baseline minus 14 tests.

**Definition of done**
- [ ] `server/src/cli/` directory does not exist
- [ ] `server/package.json` has no `pre-review` script
- [ ] `cd server && npx tsc --noEmit` exits 0
- [ ] `cd server && npm test` exits 0 (162 green tests, or baseline − 14)

---

### T7: Supersede PLAN-local-pre-review-cli.md  `MODULE: docs`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | none |
| **Parallel with** | T1 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `docs/plans/PLAN-local-pre-review-cli.md` | edit | add superseded note at the very top |

**Approach**

1. Insert the following line at the very top of `docs/plans/PLAN-local-pre-review-cli.md`, before the `# Plan:` heading:

   `> **Superseded by** PLAN-pre-review-cli-bug-fix.md — the CLI now lives in mcp-server and is invoked as \`devdigest review\`. Do not execute this plan.`

2. No other changes.

**Definition of done**
- [ ] `docs/plans/PLAN-local-pre-review-cli.md` has the superseded note at the top

---

## Parallelisation map

```
T1 ──► T2 ──► T5 ──► T6
    └─► T3 ──►┘
    └─► T4

T7 (fully independent — parallel with T1)
```

T1 and T7 can start immediately and in parallel.
T2, T3, T4 each start once T1 completes; they create different files and are parallel with each other.
T5 must wait for T2 and T3 (test files import from those source files).
T6 must wait for T5 (server files must not be deleted until mcp-server tests are confirmed green).

**File conflict check (must be clean before Status: READY)**

| File | Assigned to | Parallel tasks | Conflict? |
|---|---|---|---|
| `mcp-server/package.json` | T1 (add deps, bin, scripts) | T2, T3, T4 (T4 reads bin field; does not re-edit) | No conflict — T4 depends on T1 and reads the field set there |
| `mcp-server/tsconfig.json` | T1 (add alias entries) | T2, T3, T4 (read-only consumers) | No conflict |
| `mcp-server/vitest.config.ts` | T1 (create) | none | No conflict |
| `mcp-server/src/cli/diff-source.ts` | T2 | T3, T4 | No conflict — different files |
| `mcp-server/src/cli/diff-sources/working.ts` | T2 | T3, T4 | No conflict |
| `mcp-server/src/cli/output.ts` | T2 | T3, T4 | No conflict |
| `mcp-server/src/cli/review.ts` | T3 | T2, T4 | No conflict |
| `mcp-server/src/cli/index.ts` | T4 | T2, T3 | No conflict |
| `mcp-server/bin/devdigest` | T4 | T2, T3 | No conflict |
| `mcp-server/src/cli/*.test.ts` | T5 | none (sequential after T2+T3) | No conflict |
| `server/src/cli/*` (7 files) | T6 | none (sequential after T5) | No conflict |
| `server/package.json` | T6 | none | No conflict |
| `docs/plans/PLAN-local-pre-review-cli.md` | T7 | T1 | No conflict — different files |

## Risks

- **`@devdigest/server/adapters` wildcard alias** allows mcp-server to reach any file under `server/src/adapters/`. This is wider than strictly necessary but consistent with the existing `@devdigest/shared/*` pattern. Any future adapter file that imports server-internal deps unavailable in mcp-server will fail at typecheck time — acceptable, caught immediately.
- **Vitest alias vs tsconfig alias drift:** If `vitest.config.ts` and `tsconfig.json` aliases diverge, tests can pass while typecheck fails (or vice versa). T1 specifies both together to reduce drift risk; the implementer must keep them in sync.
- **`openai` version alignment:** The `openai` package is in reviewer-core at `^4.77.0`. If mcp-server installs a different semver-compatible version, subtle type incompatibilities may arise when using the server's `openai.ts` adapter via the alias. Pinning the same range avoids this.
- **Shell script portability:** The `bin/devdigest` script uses `bash` and `BASH_SOURCE`, standard on macOS/Linux. Windows users (Git Bash/WSL) are unaffected for course purposes; a `.mjs` wrapper could replace it if cross-platform support is needed (out of scope).
- **Server test count:** Removing 14 tests from server takes the count from 176 to 162. If other server tests were added between the 2026-07-06 session and this implementation, the baseline may differ. The implementer should confirm the actual before/after counts rather than relying on the hardcoded 162.
- **`npm link` requirement:** `devdigest` is only available system-wide after `npm link` in mcp-server/. This is a one-time developer setup step, not a bug, but should be documented in the package README (out of scope for this plan).

## Global definition of done
- [ ] All mcp-server tests pass: `cd mcp-server && npm test` (14 tests green)
- [ ] mcp-server typechecks: `cd mcp-server && npx tsc --noEmit` exits 0
- [ ] All server tests pass: `cd server && npm test` (prior baseline minus 14, green)
- [ ] Server typechecks: `cd server && npx tsc --noEmit` exits 0
- [ ] Requirements → Task coverage table is complete (no uncovered rows)
- [ ] File conflict check table shows no unresolved conflicts
- [ ] Manual smoke: `devdigest review --help` prints usage with `deepseek/deepseek-v4-flash` as the default model
- [ ] Manual smoke: `devdigest review --mode working` from a git repo with working-tree changes and a valid `OPENROUTER_API_KEY` runs to completion without a 404 error
- [ ] Plan marked `Status: READY`
