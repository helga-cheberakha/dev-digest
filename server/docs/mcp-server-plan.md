# Plan: MCP Server for DevDigest
> Status: READY
> Date: 2026-06-30
> Author: planner agent

## Overview

Build a local-first MCP (Model Context Protocol) server for DevDigest that exposes 5 tools
to AI assistants (Claude Desktop, VS Code Copilot). The server lives in `server/src/mcp.ts`
as a separate Node.js entrypoint — not a Fastify plugin — sharing the existing DI container
and service layer directly. The user-visible outcome is that any MCP-capable AI assistant
can list agents, trigger a full PR review, and retrieve findings or conventions from the
local DevDigest instance without writing any code.

---

## Requirements → Task coverage

| Requirement | Task(s) |
|---|---|
| `list_agents` tool — lists registered agents with id, name, enabled | T3 |
| `run_agent_on_pr` tool — the only write tool; triggers review, polls until done, returns findings | T3 |
| `get_findings` tool — compact verdict for an already-completed run | T3 |
| `get_conventions` tool — returns accepted repo coding conventions | T3 |
| `get_blast_radius` tool — stub only; returns placeholder | T3 |
| Flat arguments — no nested objects in any tool's inputSchema | T3 |
| Result-not-operation — `run_agent_on_pr` does trigger + poll + fetch in one call | T3 |
| Compact structured response — lean DTOs, no raw DB records | T3 |
| Error-leads-forward — error messages include actionable next step | T3 |
| Description fields ≤50 words (token efficiency) | T3 |
| stdout corruption guard — all logging to stderr only | T4 |
| MCP error protocol — protocol errors throw; tool errors return `isError: true` | T3 |
| `@modelcontextprotocol/sdk` v1.29.0 added as dependency | T1 |
| `mcp` script in `server/package.json` | T1 |
| `tsconfig.json` includes `src/mcp.ts` | T1 (verify only) |
| workspaceId resolution without HTTP request | T2 |
| Polling strategy for `run_agent_on_pr` (timeout + interval) | T3 |
| Claude Desktop and VS Code config snippet | T5 |
| Server docs for MCP setup | T5 |

---

## Scope

### Modules affected
- [x] server — new entrypoint `src/mcp.ts`, new directory `src/modules/mcp/`, modifications to `package.json`; `tsconfig.json` requires no edit (glob already covers `src/**/*.ts`)
- [ ] client — no changes
- [ ] reviewer-core — no changes
- [ ] e2e — no new E2E tests (MCP stdio transport is not accessible from the browser CDP runner)

### Explicitly out of scope
- No `src/modules/index.ts` changes (MCP is NOT a Fastify plugin)
- No database migrations (MCP reads/triggers existing tables only)
- No changes to `src/vendor/shared/` contracts
- No new service methods in `AgentsService`, `ReviewService`, or `ConventionsService` — existing methods are sufficient
- No CI integration or production deployment of the MCP server
- Full blast radius implementation (homework task; T3 covers the stub only)
- VS Code extension setup (out of scope; the docs note covers it)

---

## Engineering Insights from Codebase

### server

- **workspaceId without HTTP**: `AuthProvider.currentWorkspace(req: unknown)` and `LocalNoAuthProvider.currentWorkspace()` ignore the `req` argument; they only query the DB for the single seeded default workspace. Calling `container.auth.currentWorkspace(null)` is type-safe (null satisfies unknown) and returns the correct workspace for this single-tenant local-first app. Source: `src/adapters/auth/local.ts`, `src/vendor/shared/adapters.ts:268-270`.

- **Fire-and-forget review execution**: `ReviewService.runReview()` returns immediately with `{ runs: [{ run_id }], reviews: [] }` — the actual review runs in the background as `void this.executor.executeRuns(...)`. The `reviews` array is always empty in the return value; results are only available via `reviewsForPull()` after the run finishes. Source: `src/modules/reviews/service.ts:103-138`.

- **Active run detection**: `ReviewRepository.activeRunsForPull()` queries `agent_runs WHERE status = 'running'`. A run disappears from this query when it transitions to `done`, `failed`, or `cancelled`. After polling detects disappearance, `ReviewRepository.listRunsForPull()` reveals the terminal status and error field. Source: `src/modules/reviews/repository/run.repo.ts:10-37`.

- **PR-by-number lookup**: Pull requests are identified by UUID in service calls (`prId: string`). There is no existing service method to look up a PR by `(repo_full_name, pr_number)`. The `repos` table has a unique index on `(workspace_id, full_name)` and `pull_requests` has a unique index on `(repo_id, number)`. A two-step DB query in `modules/mcp/helpers.ts` is required. Source: `src/db/schema/repos.ts`, `src/db/schema/pulls.ts`.

- **ReviewDto has `run_id` field**: After polling completes, finding the matching review from `reviewsForPull()` is done by filtering on `dto.run_id === runId`. Source: `src/modules/reviews/helpers.ts:19-32`.

- **Convention service scopes by `repoId` UUID**: `ConventionsService.list(workspaceId, repoId)` takes the repo's UUID, not `full_name`. The MCP `get_conventions` tool must resolve `full_name → uuid` before calling the service. Same two-step lookup as PR resolution. Source: `src/modules/conventions/service.ts:27-30`.

- **Modules registry pattern** (from AGENTS.md): New feature = new module + one line in `src/modules/index.ts`. The MCP module (`modules/mcp/`) is NOT registered in `modules/index.ts` because it is not a Fastify plugin — it is called directly from `src/mcp.ts`. Explicitly do NOT add it to the registry.

- **DB client initialization**: `createDb(url, { max?: number })` returns `{ db, sql, close }`. The MCP server should use `max: 1` (single connection) since it handles one request at a time (stdio transport is serial). Source: `src/db/client.ts`.

- **ESM imports carry `.js` extension**: All relative imports in the server package use `.js` extensions even for `.ts` source files (ESM + Bundler moduleResolution). Source: `tsconfig.json`, existing modules.

- **Static-segment route ordering** (INSIGHTS.md, 2026-06-18): Not directly relevant here (MCP has no HTTP routes), but the INSIGHTS pattern of registering fixed-path tools before parameterized ones applies to MCP tool registration order for predictability.

### client
- No relevant insights for this plan.

### reviewer-core / e2e
- No relevant insights for this plan.

---

## Implementation Tasks

---

### T1: Package configuration  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | none |
| **Parallel with** | T2, T5 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/package.json` | edit | Add `@modelcontextprotocol/sdk` dependency + `mcp` script |
| `server/tsconfig.json` | verify only (no edit) | Confirm `"include": ["src/**/*.ts"]` already covers `src/mcp.ts` |

**Approach**

1. Open `server/package.json`. Under `"dependencies"`, add `"@modelcontextprotocol/sdk": "^1.29.0"`. Place it alphabetically among existing dependencies.

2. Under `"scripts"`, add `"mcp": "tsx src/mcp.ts"`. This entry is how the MCP server is launched in development (and is what Claude Desktop will invoke).

3. Confirm that `server/tsconfig.json` `"include"` is `["src/**/*.ts"]` — this glob already covers `src/mcp.ts`. No edit to `tsconfig.json` is needed. Note this in the PR description.

4. Run `npm install` inside `server/` to update the lockfile. The plan does not mandate this step in the implementer workflow (the CI pipeline does it), but document it as a prerequisite for running `npm run mcp`.

**Tests**

- Existing tests that must stay green: all `server/test/**` (no change to tested code paths)
- New tests to write: none for package.json changes

**Definition of done**
- [ ] `server/package.json` contains `"@modelcontextprotocol/sdk": "^1.29.0"` in dependencies
- [ ] `server/package.json` contains `"mcp": "tsx src/mcp.ts"` in scripts
- [ ] `server/tsconfig.json` is unchanged and confirmed to include `src/mcp.ts` via the existing glob
- [ ] TypeScript compiles (`npx tsc --noEmit`) with zero errors in the server module after T4 is complete

---

### T2: MCP helpers module  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | none |
| **Parallel with** | T1, T5 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/src/modules/mcp/helpers.ts` | create | DB lookup helpers and workspace resolution; no other task touches this file |

**Approach**

1. Create directory `server/src/modules/mcp/` and file `helpers.ts`. This file is a pure helper module — no default export, only named exports.

2. **`resolveWorkspace(container: Container): Promise<{ workspaceId: string }>`** — calls `container.auth.currentWorkspace(null)` (the `LocalNoAuthProvider` ignores the `req` argument; `null` satisfies `req: unknown`). Returns `{ workspaceId: workspace.id }`. On failure (workspace not seeded), the thrown error propagates up and is caught by the tool handler.

3. **`lookupRepoByFullName(db: Db, workspaceId: string, fullName: string): Promise<RepoRow | undefined>`** — perform a direct Drizzle query: `db.select().from(t.repos).where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName))).limit(1)`. Import `t` from `../../db/schema.js`, `eq` and `and` from `drizzle-orm`. Return the first row or `undefined`. This is a consistent pattern with existing drift in `pulls/routes.ts` (see onion-architecture known-drift notes).

4. **`lookupPrByNumber(db: Db, workspaceId: string, repoId: string, prNumber: number): Promise<PullRow | undefined>`** — direct Drizzle query: `db.select().from(t.pullRequests).where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, prNumber))).limit(1)`. Return the first row or `undefined`.

5. **`sleep(ms: number): Promise<void>`** — returns a `new Promise(resolve => setTimeout(resolve, ms))`. Used by the polling loop in tools.ts.

6. **`makeStderrLogger(): Logger`** — returns an object implementing the `Logger` interface from `src/modules/reviews/run-executor.ts`. Each method writes to `process.stderr` only. This is passed to `ReviewService.runReview()` to prevent any background logging from corrupting stdout. The `Logger` type must be imported with `import type { Logger } from '../reviews/run-executor.js'`.

7. All imports use the `.js` extension on relative paths (ESM convention enforced by the tsconfig `moduleResolution: "Bundler"`).

**Tests**

- Existing tests that must stay green: no existing tests cover `modules/mcp/` (new module)
- New tests to write: none required in this task (helpers are thin wrappers over Drizzle; the integration tests in T3/T4 validate them)

**Definition of done**
- [ ] `server/src/modules/mcp/helpers.ts` exists and exports the 5 named functions
- [ ] TypeScript compiles with zero errors in `helpers.ts`
- [ ] No import of Fastify, Pino, or any HTTP-transport module

---

### T3: MCP tool handlers  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | T2 |
| **Parallel with** | none |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/src/modules/mcp/tools.ts` | create | All 5 tool handler implementations |

**Approach**

1. Create `server/src/modules/mcp/tools.ts`. Export a single function `registerTools(server: McpServer, container: Container): void` that calls `server.tool(name, description, inputSchema, handler)` for each of the 5 tools. Import `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`. Import `Container` from `../../platform/container.js`. Import helpers from `./helpers.js`.

2. **Error protocol (apply to every tool handler)**:
   - Protocol errors (unknown tool, malformed JSON-RPC) — the SDK handles these by catching thrown errors; do NOT throw from a handler for domain errors.
   - Tool execution errors (not found, timeout, etc.) — return `{ content: [{ type: 'text' as const, text: '<message>' }], isError: true }`. Never throw inside a tool handler.
   - Wrap every handler body in a try/catch; the catch block returns `{ content: [{ type: 'text', text: err.message }], isError: true }`.

3. **Tool: `list_agents`**
   - `description` (≤50 words): `"List all review agents configured in DevDigest. Returns id, name, and enabled status for each agent. Use the id value with run_agent_on_pr to trigger a review."`
   - `inputSchema` (Zod): `z.object({})` — no parameters
   - Handler steps:
     a. `const { workspaceId } = await resolveWorkspace(container)`
     b. Construct `AgentsService` from `../../modules/agents/service.js`; call `service.list(workspaceId)`
     c. Map each `Agent` to `{ id, name, enabled }` — omit all other fields (compact DTO)
     d. Return `{ content: [{ type: 'text', text: JSON.stringify({ agents }, null, 2) }] }`
   - Error: if workspace resolution fails — `"DevDigest workspace not found. Run db:seed to initialise the database."`

4. **Tool: `run_agent_on_pr`** (the ONLY write tool)
   - `description` (≤50 words): `"Run a review agent on a pull request. Triggers the review, waits for completion, then returns the verdict and findings. This is the only tool that writes data. Call list_agents first to get a valid agent_id."`
   - `inputSchema` (Zod):
     ```
     z.object({
       repo:      z.string().min(1).describe("Repository full name e.g. 'owner/name'"),
       pr_number: z.number().int().positive(),
       agent_id:  z.string().uuid(),
     })
     ```
   - Handler steps (apply "Result, not operation" principle):
     a. `const { workspaceId } = await resolveWorkspace(container)`
     b. `const repo = await lookupRepoByFullName(container.db, workspaceId, input.repo)` — if undefined return isError: `"Repository '${input.repo}' not found in DevDigest. Verify it is imported via the Repos tab."`
     c. `const pr = await lookupPrByNumber(container.db, workspaceId, repo.id, input.pr_number)` — if undefined return isError: `"Pull request #${input.pr_number} not found in '${input.repo}'. Verify the PR is synced in DevDigest."`
     d. Construct `ReviewService`; call `service.resolveTargets(workspaceId, { agentId: input.agent_id })` — catch `NotFoundError`: return isError: `"Agent '${input.agent_id}' not found. Call list_agents to see available agent IDs."`
     e. Call `service.runReview(workspaceId, pr.id, targets, makeStderrLogger())` — capture `runs[0].run_id`
     f. **Polling loop** (see §Polling Strategy): poll `service.activeRuns(workspaceId, pr.id)` every 3000ms, timeout 300,000ms. Exit when `runId` is absent from the active list.
     g. After polling: call `service.listRuns(workspaceId, pr.id)` to find the run by `run_id`. If status is `'failed'`: return isError: `"Review run failed: ${run.error || 'unknown error'}. Check the DevDigest UI for details."`. If status is `'cancelled'`: return isError: `"Review run was cancelled."`.
     h. Call `service.reviewsForPull(workspaceId, pr.id)`; find the entry where `dto.run_id === runId`.
     i. Map to compact DTO: `{ verdict, score, summary, findings: findings.map(f => ({ severity: f.severity, title: f.title, file: f.file, start_line: f.start_line, category: f.category })) }`
     j. Return `{ content: [{ type: 'text', text: JSON.stringify(dto, null, 2) }] }`
   - Timeout error message: `"Review timed out after 5 minutes. The run may still be in progress — try get_findings later."`

5. **Tool: `get_findings`**
   - `description` (≤50 words): `"Get review findings for a pull request. Returns all completed review verdicts and findings. If no review exists yet, call run_agent_on_pr first."`
   - `inputSchema` (Zod):
     ```
     z.object({
       repo:      z.string().min(1).describe("Repository full name e.g. 'owner/name'"),
       pr_number: z.number().int().positive(),
     })
     ```
   - Handler steps:
     a. Resolve workspace, lookup repo (error if not found — same messages as above), lookup PR (same)
     b. Construct `ReviewService`; call `service.reviewsForPull(workspaceId, pr.id)`
     c. If empty array: return isError: `"No reviews found for PR #${pr_number} in '${repo}'. Run run_agent_on_pr to create one."`
     d. Map each `ReviewDto` to compact form: `{ agent_name, verdict, score, created_at, findings: findings.map(f => ({ severity, title, file, start_line, category })) }`
     e. Return `{ content: [{ type: 'text', text: JSON.stringify({ reviews: dtos }, null, 2) }] }`

6. **Tool: `get_conventions`**
   - `description` (≤50 words): `"Get accepted coding conventions for a repository. Returns approved rules extracted from the codebase. Call conventions/extract via the API first if the list is empty."`
   - `inputSchema` (Zod):
     ```
     z.object({
       repo: z.string().min(1).describe("Repository full name e.g. 'owner/name'"),
     })
     ```
   - Handler steps:
     a. Resolve workspace, lookup repo (error if not found)
     b. Construct `ConventionsService`; call `service.list(workspaceId, repo.id)`
     c. Filter to `status === 'accepted'` only (lean result; rejected/pending conventions are noise for an AI assistant)
     d. Map to compact: `{ rule, category, file_path, confidence }` — omit `id`, `workspace_id`, `snippet`, etc.
     e. If empty: return `{ conventions: [], message: "No accepted conventions found for '${input.repo}'. Extract and accept conventions via the DevDigest Conventions tab first." }` (not isError — an empty result is valid)
     f. Return `{ content: [{ type: 'text', text: JSON.stringify({ conventions: dtos }, null, 2) }] }`

7. **Tool: `get_blast_radius`** (stub)
   - `description` (≤50 words): `"Get the blast radius impact map for a pull request. Shows which parts of the codebase are most affected. (Stub — full implementation pending.)"`
   - `inputSchema` (Zod):
     ```
     z.object({
       repo:      z.string().min(1).describe("Repository full name e.g. 'owner/name'"),
       pr_number: z.number().int().positive(),
     })
     ```
   - Handler: return `{ content: [{ type: 'text', text: JSON.stringify({ status: 'not_implemented', message: 'Blast radius is not yet available. Full implementation is coming in the homework assignment.' }) }] }` — no isError flag (it is not an error; it is a planned stub)

8. Import `z` from `zod` for all inputSchema definitions. Follow the `zod` skill: use `.min()`, `.positive()`, `.uuid()` to encode constraints in the type rather than in `.describe()` text. Keep `.describe()` only for semantic guidance that cannot be expressed in the type (e.g. the example format of `repo`).

9. Import `AgentsService`, `ReviewService`, and `ConventionsService` from their respective modules using `.js` extension. Construct each service inside the handler (they are stateless services with a cheap constructor — consistent with how routes construct them).

**Tests**

- Existing tests that must stay green: all `server/test/**`
- New tests to write: none required as part of this plan (functional validation is done by running the MCP server end-to-end). A future task could add unit tests with mocked services.

**Definition of done**
- [ ] `server/src/modules/mcp/tools.ts` exists and exports `registerTools(server, container)`
- [ ] All 5 tools are registered with description ≤50 words (word count verified)
- [ ] All 5 inputSchema definitions use flat args only (no nested objects)
- [ ] Compact response DTOs omit raw DB fields (no leaking of `workspace_id`, `repo_id`, `agent_id` UUIDs, etc.)
- [ ] Every tool handler has a top-level try/catch returning `isError: true` for domain errors
- [ ] Error messages follow "error leads forward" — each tells the LLM what to call next
- [ ] TypeScript compiles with zero errors

---

### T4: MCP server entrypoint  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | T3 |
| **Parallel with** | none |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/src/mcp.ts` | create | Separate Node.js entrypoint; wires container + McpServer + StdioServerTransport |

**Approach**

1. **stdout corruption guard — first lines of `mcp.ts`**: Before any other imports, install a global redirect of `console.log` and `console.info` to `process.stderr`. This defends against accidental stdout writes anywhere in the imported graph:
   - `console.log = (...args) => process.stderr.write(args.join(' ') + '\n')`
   - `console.info = (...args) => process.stderr.write(args.join(' ') + '\n')`
   - Leave `console.warn` and `console.error` as-is (they already write to stderr by default, but patching them to be explicit is also acceptable)
   - Do this BEFORE the `import 'dotenv/config'` line (though ESM static imports hoist, the override still protects the runtime call sites)

2. Import `'dotenv/config'` to load `.env` file (same as `server/src/server.ts` pattern via `loadConfig`).

3. Import and call `loadConfig()` from `./platform/config.js`. This loads `DATABASE_URL` and other env vars with Zod validation.

4. Import `createDb` from `./db/client.js`. Call `createDb(config.databaseUrl, { max: 1 })` — pool size 1 is sufficient for the serial stdio transport.

5. Import `Container` from `./platform/container.js`. Construct `new Container(config, dbHandle.db)`.

6. Eagerly validate workspace: call `await container.auth.currentWorkspace(null)`. If this throws, write the error to `process.stderr` and `process.exit(1)` — an MCP server without a workspace is non-functional and should fail fast.

7. Import `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`. Construct:
   ```
   const server = new McpServer({ name: 'devdigest', version: '0.1.0' })
   ```

8. Import `registerTools` from `./modules/mcp/tools.js`. Call `registerTools(server, container)`.

9. Import `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`. Connect:
   ```
   const transport = new StdioServerTransport()
   await server.connect(transport)
   ```
   At this point the process enters the stdio event loop and handles JSON-RPC messages.

10. Graceful shutdown: register `process.once('SIGTERM', ...)` and `process.once('SIGINT', ...)` handlers that call `await server.close()` followed by `await dbHandle.close()` then `process.exit(0)`.

11. Do NOT import Fastify, Pino, SSE plugins, or any Fastify plugin. This file must remain free of HTTP transport concerns.

12. Do NOT import `modules/index.ts` (the Fastify module registry is not used here).

**Tests**

- Existing tests that must stay green: all `server/test/**`
- New tests to write: none — the entrypoint is thin wiring code; integration validation is done by running `npm run mcp` and connecting Claude Desktop

**Definition of done**
- [ ] `server/src/mcp.ts` exists and imports NO Fastify-related modules
- [ ] The first runtime statements redirect `console.log` and `console.info` to `process.stderr`
- [ ] `McpServer` and `StdioServerTransport` are from `@modelcontextprotocol/sdk`
- [ ] `Container` is constructed via `new Container(config, db)` — NOT via `buildApp()`
- [ ] `registerTools(server, container)` is called before `server.connect(transport)`
- [ ] Graceful shutdown (SIGTERM/SIGINT) closes both the MCP server and the DB pool
- [ ] TypeScript compiles with zero errors in `mcp.ts`

---

### T5: MCP server documentation  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | none |
| **Parallel with** | T1, T2 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/docs/mcp.md` | create | Setup instructions, tool reference, and ready-to-paste client configs |

**Approach**

1. Write `server/docs/mcp.md` with the following sections:

   **Prerequisites**: DevDigest server must be running (DB seeded, `.env` configured with `DATABASE_URL`). The MCP server connects to the same PostgreSQL database.

   **Running the MCP server manually**:
   ```
   cd server
   npm run mcp
   ```

   **Claude Desktop configuration** — ready to copy-paste. The user must replace `ABSOLUTE_PATH_TO_SERVER` with the actual filesystem path:
   ```json
   {
     "mcpServers": {
       "devdigest": {
         "command": "node",
         "args": [
           "--import", "tsx/esm",
           "ABSOLUTE_PATH_TO_SERVER/src/mcp.ts"
         ],
         "cwd": "ABSOLUTE_PATH_TO_SERVER",
         "env": {
           "DATABASE_URL": "postgres://devdigest:devdigest@localhost:5432/devdigest"
         }
       }
     }
   }
   ```
   Config file location: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

   **VS Code (GitHub Copilot / Copilot Chat)** config in `.vscode/mcp.json`:
   ```json
   {
     "servers": {
       "devdigest": {
         "type": "stdio",
         "command": "node",
         "args": [
           "--import", "tsx/esm",
           "${workspaceFolder}/server/src/mcp.ts"
         ],
         "env": {
           "DATABASE_URL": "postgres://devdigest:devdigest@localhost:5432/devdigest"
         }
       }
     }
   }
   ```

   **Environment variables**: Table with `DATABASE_URL` (required), `DEVDIGEST_CLONE_DIR` (optional), `NODE_ENV` (defaults to `development`).

   **Tool reference** — one row per tool with name, inputs, and what it returns.

   **stdout corruption warning**: A note explaining that the MCP server must never write to stdout. Any `console.log()` calls in application code will corrupt the JSON-RPC stream. All logging goes to stderr (visible in the Claude Desktop log viewer).

   **Known limitation**: `get_blast_radius` is a stub that always returns `status: "not_implemented"`.

2. Do NOT write code in the doc. Use JSON and shell command blocks only.

**Tests**

- None — documentation file

**Definition of done**
- [ ] `server/docs/mcp.md` exists with all sections listed above
- [ ] Claude Desktop config block is present, syntactically valid JSON, and clearly marks where the user must substitute their path
- [ ] VS Code config block is present and syntactically valid JSON
- [ ] Tool reference table lists all 5 tools

---

## Parallelisation map

```
T1 (package.json) ──────────────────────────────────────┐
                                                         │ (no file dependency,
T2 (mcp/helpers.ts) ──► T3 (mcp/tools.ts) ──► T4 (mcp.ts) ─────► DONE
                                                         │
T5 (docs/mcp.md) ────────────────────────────────────────┘
```

T1, T2, and T5 may run in parallel.
T3 depends on T2 (imports helpers).
T4 depends on T3 (imports tools).
T1 and T5 have no code dependencies on any other task.

**File conflict check (must be clean before Status: READY)**

| File | Assigned to | Parallel tasks | Conflict? |
|---|---|---|---|
| `server/package.json` | T1 | T2, T5 | No — T2 and T5 do not touch `package.json` |
| `server/src/modules/mcp/helpers.ts` | T2 | T1, T5 | No — new file; only T2 creates it |
| `server/src/modules/mcp/tools.ts` | T3 | none | No — T3 runs after T2 completes |
| `server/src/mcp.ts` | T4 | none | No — T4 runs after T3 completes |
| `server/docs/mcp.md` | T5 | T1, T2 | No — new file; only T5 creates it |

---

## Polling strategy for `run_agent_on_pr`

The polling algorithm lives inside the `run_agent_on_pr` tool handler in `tools.ts`.

```
CONSTANTS:
  POLL_INTERVAL_MS = 3_000      (3 seconds)
  POLL_TIMEOUT_MS  = 300_000    (5 minutes)

ALGORITHM:
  deadline = Date.now() + POLL_TIMEOUT_MS
  while Date.now() < deadline:
    await sleep(POLL_INTERVAL_MS)
    activeRuns = await reviewService.activeRuns(workspaceId, prId)
    if no entry with run_id === runId in activeRuns:
      BREAK — run has finished (done, failed, or cancelled)
    // still running — continue

  if Date.now() >= deadline:
    return isError: "Review timed out after 5 minutes. The run may still be in progress — try get_findings later."

  // run finished — determine terminal status
  allRuns = await reviewService.listRuns(workspaceId, prId)
  targetRun = allRuns.find(r => r.run_id === runId)
  if targetRun.status === 'failed':
    return isError: "Review run failed: {targetRun.error}. Check the DevDigest UI for details."
  if targetRun.status === 'cancelled':
    return isError: "Review run was cancelled."

  // status === 'done' — fetch the review
  reviews = await reviewService.reviewsForPull(workspaceId, prId)
  dto = reviews.find(r => r.run_id === runId)
  if not dto:
    return isError: "Review completed but result not found. Try get_findings for PR #{pr_number}."
  return compact DTO
```

Rationale for 3s interval: review runs typically take 15–60 seconds depending on diff size and LLM latency. A 3s poll adds at most one extra 3s delay while keeping DB load negligible.

Rationale for 5 min timeout: this covers very large PRs (map-reduce strategy on a large diff). The MCP client (Claude Desktop) does not apply its own tool timeout shorter than this by default.

---

## workspaceId resolution

**Chosen approach**: Call `container.auth.currentWorkspace(null)` at the start of each tool handler via the shared `resolveWorkspace(container)` helper.

**Rationale**:
- `AuthProvider.currentWorkspace(req: unknown)` — the `req` parameter is typed as `unknown`. Passing `null` is type-safe.
- `LocalNoAuthProvider.currentWorkspace()` ignores the `req` argument; it only queries the `workspaces` table for the single row matching `DEFAULT_WORKSPACE_NAME`. This is the seeded default workspace.
- DevDigest is single-tenant local-first: there is exactly one workspace per DB instance. No env var `DEVDIGEST_WORKSPACE_ID` is needed.
- If the workspace is not seeded (`db:seed` not run), `currentWorkspace(null)` throws "No default workspace found — run `pnpm db:seed`." The tool handler's try/catch returns this as an `isError: true` response, which tells the user exactly what to do.
- This approach is consistent with how `getContext(container, req)` works for HTTP routes, just without the HTTP request wrapper.

---

## stdout/stderr split — exact logger config for `mcp.ts`

The stdio transport uses `process.stdout` (fd 1) exclusively for JSON-RPC messages. ANY write to stdout outside the MCP SDK — including `console.log`, `console.info`, Pino logger output, Node.js warnings — corrupts the stream silently (the client disconnects with no error message).

**What `mcp.ts` must do**:

1. **Patch console methods** as the very first statements (before any module side effects):
   ```
   console.log = (...args) => process.stderr.write(args.map(String).join(' ') + '\n')
   console.info = (...args) => process.stderr.write(args.map(String).join(' ') + '\n')
   ```
   `console.warn` and `console.error` already write to stderr by default; patching them is optional but harmless.

2. **Do NOT start Fastify** — Fastify initialises a Pino logger that writes to stdout. The `mcp.ts` entrypoint never imports `buildApp()` or `Fastify`.

3. **Pass `makeStderrLogger()` to `runReview()`** — the `ReviewRunExecutor` accepts an optional `Logger` for background job logs. Without this, those log statements are silent (undefined logger). With it, they go to stderr where Claude Desktop shows them in its log viewer.

4. **`postgres` connection logs**: The `postgres` npm package does not log to stdout by default. No extra configuration needed.

5. **`dotenv/config`**: `dotenv` writes nothing to stdout by default.

**Why not suppress all logging**: Errors written to stderr appear in the Claude Desktop MCP log viewer, which is valuable for debugging. Silence would make failures invisible.

---

## Changes outside the MCP module

| Change | File | What |
|---|---|---|
| Add SDK dependency | `server/package.json` | `"@modelcontextprotocol/sdk": "^1.29.0"` |
| Add launch script | `server/package.json` | `"mcp": "tsx src/mcp.ts"` |
| No edit needed | `server/tsconfig.json` | `"include": ["src/**/*.ts"]` already covers `src/mcp.ts` |
| No edit needed | `server/src/modules/index.ts` | MCP is NOT a Fastify plugin; do not register it here |
| No new migration | `server/src/db/migrations/` | MCP reads/triggers existing tables only |

---

## Tool definitions (complete reference)

### `list_agents`

| Field | Value |
|---|---|
| name | `list_agents` |
| description | `"List all review agents configured in DevDigest. Returns id, name, and enabled status for each agent. Use the id value with run_agent_on_pr to trigger a review."` (18 words) |
| inputSchema | `z.object({})` |
| response DTO | `{ agents: Array<{ id: string, name: string, enabled: boolean }> }` |
| error messages | "DevDigest workspace not found. Run db:seed to initialise the database." |

### `run_agent_on_pr`

| Field | Value |
|---|---|
| name | `run_agent_on_pr` |
| description | `"Run a review agent on a pull request. Triggers the review, waits for completion, then returns the verdict and findings. This is the only tool that writes data. Call list_agents first to get a valid agent_id."` (37 words) |
| inputSchema | `z.object({ repo: z.string().min(1).describe("Repository full name e.g. 'owner/name'"), pr_number: z.number().int().positive(), agent_id: z.string().uuid() })` |
| response DTO | `{ verdict: string, score: number\|null, summary: string, findings: Array<{ severity: string, title: string, file: string, start_line: number, category: string }> }` |
| error messages | Repo not found: "Repository '{repo}' not found in DevDigest. Verify it is imported via the Repos tab." / PR not found: "Pull request #{pr_number} not found in '{repo}'. Verify the PR is synced in DevDigest." / Agent not found: "Agent '{agent_id}' not found. Call list_agents to see available agent IDs." / Timeout: "Review timed out after 5 minutes. The run may still be in progress — try get_findings later." / Run failed: "Review run failed: {error}. Check the DevDigest UI for details." |

### `get_findings`

| Field | Value |
|---|---|
| name | `get_findings` |
| description | `"Get review findings for a pull request. Returns all completed review verdicts and findings. If no review exists yet, call run_agent_on_pr first."` (24 words) |
| inputSchema | `z.object({ repo: z.string().min(1).describe("Repository full name e.g. 'owner/name'"), pr_number: z.number().int().positive() })` |
| response DTO | `{ reviews: Array<{ agent_name: string\|null, verdict: string\|null, score: number\|null, created_at: string, findings: Array<{ severity: string, title: string, file: string, start_line: number, category: string }> }> }` |
| error messages | Repo not found: same as above. PR not found: same as above. No reviews: "No reviews found for PR #{pr_number} in '{repo}'. Run run_agent_on_pr to create one." |

### `get_conventions`

| Field | Value |
|---|---|
| name | `get_conventions` |
| description | `"Get accepted coding conventions for a repository. Returns approved rules extracted from the codebase. Call conventions/extract via the API first if the list is empty."` (27 words) |
| inputSchema | `z.object({ repo: z.string().min(1).describe("Repository full name e.g. 'owner/name'") })` |
| response DTO | `{ conventions: Array<{ rule: string, category: string, file_path: string, confidence: number }> }` |
| error messages | Repo not found: same pattern. Empty result (not an error): `{ conventions: [], message: "No accepted conventions found for '{repo}'. Extract and accept conventions via the DevDigest Conventions tab first." }` |

### `get_blast_radius`

| Field | Value |
|---|---|
| name | `get_blast_radius` |
| description | `"Get the blast radius impact map for a pull request. Shows which parts of the codebase are most affected. (Stub — full implementation pending.)"` (24 words) |
| inputSchema | `z.object({ repo: z.string().min(1).describe("Repository full name e.g. 'owner/name'"), pr_number: z.number().int().positive() })` |
| response DTO | `{ status: "not_implemented", message: "Blast radius is not yet available. Full implementation is coming in the homework assignment." }` |
| error messages | None (stub always succeeds) |

---

## Risks

- **Fire-and-forget race at process death**: If the Node.js process running `mcp.ts` is killed while a review is executing, the `agent_runs` row will be left in `status = 'running'`. The existing `reapStaleRunningRuns()` in `ReviewService` is called on boot of the FASTIFY server (`app.ts`), not on boot of `mcp.ts`. If the MCP server is the one that started the review and then crashed, the next Fastify boot will reap it — but only after the API server is restarted. Consider calling `reapStaleRunningRuns()` on MCP boot as well (not in scope here; out-of-scope risk).

- **Concurrent write safety**: `run_agent_on_pr` creates an `agent_runs` row and starts background execution. If two MCP tool calls overlap (unlikely with stdio serial transport, but possible if the client queues calls), two simultaneous reviews could race. This is the same as two HTTP clients triggering reviews simultaneously — already handled by the existing service layer.

- **`agent_id` UUID format validation**: The `z.string().uuid()` validation on `agent_id` will reject any non-UUID string immediately at the schema level (MCP SDK reports a protocol-level error before calling the handler). If DevDigest ever uses non-UUID IDs, this constraint would need loosening. Currently IDs are PostgreSQL `uuid` columns so this is safe.

- **`get_conventions` only returns accepted conventions**: The plan filters to `status === 'accepted'`. Pending or rejected conventions are not returned. An LLM querying conventions on a repo where no conventions have been accepted yet will receive an empty list with a message — it will not see pending candidates. This is the correct behavior for an AI assistant (pending means not yet approved by a human), but it is worth noting.

- **Token budget for `run_agent_on_pr` response**: If a PR has many findings, the compact DTO could still be large. For extreme cases (100+ findings), the JSON response could approach the MCP content size limits. Not in scope to add truncation; risk is low for typical PRs.

- **`LocalNoAuthProvider` dependency**: The workspace resolution approach (`container.auth.currentWorkspace(null)`) is tightly coupled to the `LocalNoAuthProvider` ignoring the `req` argument. If DevDigest adds a real `AuthProvider` that reads JWT from the request, this call would fail or return the wrong workspace. Record this dependency so a future auth implementation knows to handle `null` req gracefully.

---

## Global definition of done
- [ ] All existing tests pass across all touched modules (`npm test` in `server/`)
- [ ] TypeScript compiles with zero errors across all touched modules (`npm run typecheck` in `server/`)
- [ ] Requirements → Task coverage table is complete (no uncovered rows)
- [ ] File conflict check table shows no unresolved conflicts
- [ ] `npm run mcp` starts the MCP server without writing to stdout before the SDK sends its first JSON-RPC message
- [ ] Claude Desktop can call all 5 tools without a "protocol error: malformed JSON" disconnect
- [ ] Plan marked `Status: READY`
