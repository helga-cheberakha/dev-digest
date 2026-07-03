# Plan: Local stdio MCP Server (`mcp-server/`)
> Status: READY
> Date: 2026-06-30
> Branch: lesson/04

## Overview

Build a **new top-level package `mcp-server/`** — a local stdio MCP server that exposes exactly
5 tools to Claude Code / Claude Desktop. The server is a **thin HTTP client** over the existing
DevDigest API at `http://localhost:3001` (started via `./scripts/dev.sh`). It holds **no business
logic and no DB coupling** of its own. Uses `@modelcontextprotocol/sdk` v1.x + Zod, runs with
`tsx`, reuses `@devdigest/shared` Zod contracts via the project's tsconfig path alias.

---

## Locked Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **HTTP-wrap, NOT in-process container** | MCP server talks to `localhost:3001` over HTTP; never imports `server/src/platform/container.ts` or touches the DB directly |
| **New top-level package `mcp-server/`** | Not a workspace; tsconfig path alias only — matches repo's non-monorepo convention |
| **stdio transport** | Logs → stderr only; stdout is the JSON-RPC channel |
| **`devdigest_*` namespace** | Prevents name collisions with other MCP servers in the same client |
| **`run_agent_on_pr` blocks ≤120s, 2s poll** | Returns `{ status: "running", run_id }` fallback on timeout (not `isError`) |
| **No auth headers** | `LocalNoAuthProvider` resolves the default workspace server-side |
| **Contracts consumed read-only** | No edits to `@devdigest/shared`, `server/`, `client/`, or `reviewer-core/` |

---

## Requirements Coverage

| ID | Requirement | Task(s) |
|----|-------------|---------|
| R1 | Runnable stdio server in `mcp-server/` with exactly 5 tools, nothing to stdout | T0, T10 |
| R2 | `devdigest_*` namespacing, snake_case, per-field `.describe()`, tool annotations | T4–T9 |
| R3 | `devdigest_list_agents` — agents with id, name, enabled, model | T4 |
| R4 | `devdigest_run_agent_on_pr` — result-not-operation, flat args, blocks+polls, fallback | T8a, T8 |
| R5 | `devdigest_get_findings` — concise/detailed + pagination + counts by severity | T6b, T7 |
| R6 | `devdigest_get_conventions` — repo conventions via flat `repo` arg | T5, T6 |
| R7 | `devdigest_get_blast_radius` — STUB, never throws, returns `not_implemented` | T9 |
| R8 | Id-resolution: repo name → repoId, (repo, pr#) → pull id via list endpoints | T6 |
| R9 | Two-tier errors: Zod protocol-level + `isError: true` business-level; empty ≠ error | T3, all tools |
| R10 | Root `.mcp.json` with `MCP_TOOL_TIMEOUT`, env-based config, no hardcoded secrets | T11 |
| R11 | `mcp-server/README.md` with setup, tool reference, verification steps | T12 |

---

## Affected Modules

| Module | Action |
|--------|--------|
| `mcp-server/` | **NEW** — all new code |
| `/.mcp.json` | **NEW** — project-scoped MCP registration |
| `server/`, `client/`, `reviewer-core/`, `@devdigest/shared` | **NO CHANGES** |

---

## Architecture — Onion Layers Within `mcp-server/`

The package follows onion/ports-and-adapters with no Fastify/Drizzle. Imports point inward only.

```
┌─────────────────────────────────────────────────┐
│  Presentation / Transport (index.ts, tools/*.ts) │  ← outermost
│   ┌─────────────────────────────────────────┐    │
│   │  Application / Orchestration (core/*.ts) │    │
│   │   ┌────────────────────────────────┐     │    │
│   │   │  Infrastructure / I/O          │     │    │
│   │   │  (http/client.ts)              │     │    │
│   │   │   ┌───────────────────────┐    │     │    │
│   │   │   │ Ports / Domain types  │    │     │    │
│   │   │   │ (@devdigest/shared)   │    │     │    │
│   │   │   └───────────────────────┘    │     │    │
│   │   └────────────────────────────────┘     │    │
│   └─────────────────────────────────────────┘    │
│   composition root: src/index.ts                   │
└─────────────────────────────────────────────────┘
```

| Layer | Path | May import | Must NOT import |
|-------|------|-----------|-----------------|
| Presentation | `src/index.ts`, `src/tools/*.ts` | core/*, http/client, format, config, log, SDK | — |
| Application | `src/core/*.ts` | http/client, format, @devdigest/shared | tools/*, MCP SDK |
| Infrastructure | `src/http/client.ts` | @devdigest/shared, config | core/*, tools/* |
| Shared/pure | `src/format.ts`, `src/config.ts`, `src/log.ts` | @devdigest/shared only | anything with I/O |

---

## File Tree

```
mcp-server/
├── package.json               [T0] type:module, deps, scripts
├── tsconfig.json              [T0] ESNext, Bundler, @devdigest/shared alias
├── .env.example               [T0] DEVDIGEST_API_URL=http://localhost:3001
├── .gitignore                 [T0] node_modules, .env
├── README.md                  [T12] setup, tools, verification
└── src/
    ├── index.ts               [T10] composition root — wire deps + register 5 tools + connect
    ├── config.ts              [T1] env: apiUrl, pollIntervalMs=2000, runTimeoutMs=120000
    ├── log.ts                 [T1] stderr-only logger; zero console.log
    ├── format.ts              [T3] toolOk, toolError, compactFinding, compactAgent, compactConvention
    ├── http/
    │   └── client.ts          [T2] typed fetch wrapper over localhost:3001; only file that calls fetch
    ├── core/
    │   ├── resolve.ts         [T6] resolveRepoId, resolvePullId (list-then-match, no DB)
    │   ├── findings.ts        [T6b] pickReview + shapeFindings (shared by get_findings + run_agent)
    │   └── run-review.ts      [T8a] runReviewAndWait — trigger + poll + assemble (no MCP code)
    └── tools/
        ├── list-agents.ts     [T4] registerListAgents
        ├── get-conventions.ts [T5] registerGetConventions
        ├── get-findings.ts    [T7] registerGetFindings (thin — delegates to core/findings)
        ├── run-agent-on-pr.ts [T8] registerRunAgentOnPr (thin — delegates to core/run-review)
        └── get-blast-radius.ts[T9] registerGetBlastRadius (STUB, no network call)

/.mcp.json                     [T11] project-scoped registration
```

---

## Id-Resolution Strategy (`src/core/resolve.ts`)

**Problem:** Flat args are `repo` (name/slug) and `pr` (PR number), but endpoints take internal
UUIDs (`/pulls/:id`, `/repos/:repoId`). No direct lookup-by-name endpoint exists.

**Solution — list-then-match:**

1. `resolveRepoId(client, repo)`:
   - `GET /repos` → `Repo[]` (fields: `id`, `owner`, `name`, `full_name`)
   - Match case-insensitively in order: `full_name` → `name` → `${owner}/${name}`
   - Exactly one match → return `{ repoId: id }`
   - No match → `{ error: "Repo '${repo}' not found. Available: ${repos.map(r => r.full_name).join(', ')}" }`
   - Multiple matches (ambiguous bare name) → `{ error: "Ambiguous repo name '${repo}'. Pass owner/name." }`

2. `resolvePullId(client, repo, pr)`:
   - Call `resolveRepoId` first; on error propagate
   - `GET /repos/:repoId/pulls` → `PrMeta[]` (fields: `id`, `number`)
   - Match `p.number === pr`; guard `p.id != null`
   - Found → return `{ repoId, pullId: p.id }`
   - Not found → `{ error: "PR #${pr} not found in '${repo}'. Open PRs: ${openNumbers.join(', ')}" }`

**Returns** structured values (not throws) — callers check `'error' in result`.

---

## Tool Definitions (Verbatim Copy + Schema)

### `devdigest_list_agents`
```
title: "List Agents"
description: "List the reviewer agents configured in DevDigest (id, name, model, enabled).
  Call this first to get a valid 'agent' id for devdigest_run_agent_on_pr —
  do not guess or invent agent ids."
inputSchema: z.object({})
annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
response DTO: { agents: [{ id, name, enabled, model }] }
empty result: { agents: [] }   ← NOT isError
error: "DevDigest API unreachable at <url> — start it with ./scripts/dev.sh."
```

### `devdigest_run_agent_on_pr`
```
title: "Run Agent on PR"
description: "Run one reviewer agent on a pull request and return the result. This is a single
  call that triggers the review, waits for it to finish, and returns the verdict and findings —
  you do not need to poll. Requires a valid 'agent' id from devdigest_list_agents — do not guess
  it. If the review takes longer than ~2 min it returns {status:'running', run_id, repo, pr};
  call devdigest_get_findings with the same repo and pr later."
inputSchema: z.object({
  repo:  z.string().min(1).describe("Repository as 'owner/name' (e.g. 'octocat/hello'), or just the name if unambiguous."),
  pr:    z.number().int().positive().describe("Pull request number (e.g. 42), not an internal id."),
  agent: z.string().min(1).describe("Agent id from devdigest_list_agents. Do not guess — list agents first.")
})
annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
response DTO (done):    { verdict, score, findings: [{ severity, title, file, line, rationale }] }
response DTO (timeout): { status: "running", run_id, repo, pr, message: "Review still running — call devdigest_get_findings with the same repo and pr later." }
errors (isError: true):
  - "Repository '${repo}' not found. Available: <full_name list>."
  - "PR #${pr} not found in '${repo}'. Open PRs: <numbers>."
  - "Agent '${agent}' not found. Call devdigest_list_agents to see available agent ids."
  - "Review run failed: ${error}. Check the DevDigest UI for trace details."
```

### `devdigest_get_findings`
```
title: "Get Findings"
description: "Get the verdict and findings of a completed review for a pull request. Identify the
  PR with repo + pr; optionally pass run_id to select a specific run (otherwise the latest review
  is returned). Defaults to a concise summary (top findings + counts by severity); pass
  response_format:'detailed' for full fields, and use offset/limit to page through large result sets."
inputSchema: z.object({
  repo:            z.string().min(1).describe("Repository as 'owner/name' (e.g. 'octocat/hello'), or just the name if unambiguous."),
  pr:              z.number().int().positive().describe("Pull request number (e.g. 42)."),
  run_id:          z.string().optional().describe("Optional: select a specific run (e.g. the run_id returned by devdigest_run_agent_on_pr); omit to get the latest review."),
  response_format: z.enum(["concise", "detailed"]).default("concise").describe("'concise' (default): severity, title, file:line, rationale. 'detailed': also suggestion, confidence, line range."),
  offset:          z.number().int().min(0).default(0).describe("Pagination offset over findings (default 0)."),
  limit:           z.number().int().positive().max(100).default(10).describe("Max findings to return (default 10 concise / 20 detailed); keeps the response small.")
})
annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
response DTO: { verdict, score, total, returned, offset, counts: { critical, warning, suggestion }, findings: [...] }
error (no review): "No completed review yet — run devdigest_run_agent_on_pr first or wait and call devdigest_get_findings with the run_id."
```

### `devdigest_get_conventions`
```
title: "Get Conventions"
description: "Get the coding conventions extracted for a repository (rule, file, confidence,
  accepted). Use this to justify or check a finding against the repository's house rules."
inputSchema: z.object({
  repo: z.string().min(1).describe("Repository as 'owner/name', or just the name if unambiguous.")
})
annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
response DTO: { repo, conventions: [{ rule, file, confidence, accepted }] }
empty result: { conventions: [] }   ← NOT isError
error (repo not found): "Repo '${repo}' not found. Available: <full_name list>."
```

### `devdigest_get_blast_radius` (STUB)
```
title: "Get Blast Radius"
description: "STUB — not yet implemented. Intended to map which files and symbols a PR's changes
  affect. Returns a placeholder, not real data. Do not rely on its output and do not block your
  report on it — note the limitation and continue."
inputSchema: z.object({
  repo: z.string().optional().describe("(Accepted but ignored — stub.) Repository as 'owner/name'."),
  pr:   z.number().int().optional().describe("(Accepted but ignored — stub.) Pull request number.")
})
annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
response DTO: { status: "not_implemented", message: "Blast radius not yet available — proceed without it, note the limitation." }
never throws, never makes a network call
```

---

## Implementation Tasks

### Phase 0 — Scaffold, config, HTTP client, format

#### T0 — Package skeleton
**Depends on:** none | **Parallel with:** nothing
**Owned paths:** `mcp-server/package.json`, `mcp-server/tsconfig.json`, `mcp-server/.env.example`, `mcp-server/.gitignore`

`package.json`:
```json
{
  "name": "@devdigest/mcp-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "inspect": "npx @modelcontextprotocol/inspector tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  }
}
```

`tsconfig.json` — mirrors `server/tsconfig.json` compiler options:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "noEmit": true,
    "types": ["node"],
    "paths": {
      "@devdigest/shared": ["../server/src/vendor/shared/index.ts"],
      "@devdigest/shared/*": ["../server/src/vendor/shared/*"]
    }
  },
  "include": ["src/**/*.ts"]
}
```

**Acceptance:** `cd mcp-server && npm install && npm run typecheck` exits 0 with an empty `src/index.ts`.

---

#### T1 — Config and logger
**Depends on:** T0 | **Parallel with:** nothing
**Owned paths:** `mcp-server/src/config.ts`, `mcp-server/src/log.ts`

`config.ts`:
```ts
export const config = {
  apiUrl: process.env.DEVDIGEST_API_URL ?? 'http://localhost:3001',
  pollIntervalMs: 2_000,
  runTimeoutMs: 120_000,
} as const;
```

`log.ts` — stderr-only; ZERO `console.log` anywhere in `src/`:
```ts
const write = (...args: unknown[]) => process.stderr.write(args.map(String).join(' ') + '\n');
export const log = { info: write, warn: write, error: write };
```

**Acceptance:** `npm run typecheck` passes; `grep -rn "console.log(" mcp-server/src` returns nothing.

---

#### T2 — HTTP client
**Depends on:** T1 | **Parallel with:** T3
**Owned paths:** `mcp-server/src/http/client.ts`

The **only file** that calls `fetch`. Exports typed methods:
```ts
listAgents(): Promise<Agent[]>
listRepos(): Promise<Repo[]>
listPulls(repoId: string): Promise<PrMeta[]>
triggerReview(pullId: string, agentId: string): Promise<ReviewRunResponse>
listRuns(pullId: string): Promise<RunSummary[]>
listReviews(pullId: string): Promise<ReviewRecord[]>
getTrace(runId: string): Promise<RunTrace>
listConventions(repoId: string): Promise<ConventionCandidate[]>
```

- Import all return types from `@devdigest/shared` (no local re-declaration).
- Endpoints return **bare arrays** (`GET /agents` → `Agent[]`), no `{ data: ... }` wrapper.
- `POST /pulls/:id/review` → `{ pr_id, runs: [{ run_id }], reviews: [] }`.
- HTTP errors throw `ApiError(status, url)`. Empty arrays return normally.

**Known gotcha:** Do NOT redeclare types — `grep -n "const Agent =" src/http/client.ts` must return nothing.

---

#### T3 — Shared format helpers
**Depends on:** T1 | **Parallel with:** T2
**Owned paths:** `mcp-server/src/format.ts`

```ts
toolOk(data: unknown)     → { content: [{ type: 'text', text: JSON.stringify(data) }] }
toolError(message: string)→ { content: [{ type: 'text', text: message }], isError: true }

compactFinding(f: FindingRecord)   → { severity, title, file, line: f.start_line, rationale }
compactAgent(a: Agent)             → { id, name, enabled, model }
compactConvention(c: ConventionCandidate) → { rule, file: c.evidence_path, confidence, accepted: c.accepted }
```

Pure functions, no I/O.

**Known gotcha:** Finding uses `start_line`/`end_line` (not `line`); concise shape exposes `start_line` as `line`.

---

### Phase 1 — Read-only tools (T4, T5, T6 run in parallel after Phase 0)

#### T4 — `devdigest_list_agents`
**Depends on:** T2, T3 | **Parallel with:** T5, T6
**Owned paths:** `mcp-server/src/tools/list-agents.ts`

Export `registerListAgents(server: McpServer, client: Client): void`.  
Handler: `client.listAgents()` → `{ agents: agents.map(compactAgent) }` via `toolOk`.  
Empty list → `{ agents: [] }` (NOT `isError`).  
API unreachable → `toolError("DevDigest API unreachable at ${config.apiUrl} — start it with ./scripts/dev.sh.")`.

---

#### T5 — `devdigest_get_conventions`
**Depends on:** T2, T3, T6 | **Parallel with:** T4 (after T6 exists)
**Owned paths:** `mcp-server/src/tools/get-conventions.ts`

Export `registerGetConventions(server, client, resolve): void`.  
Handler: `resolveRepoId(client, repo)` → `client.listConventions(repoId)` → `{ repo, conventions: c.map(compactConvention) }`.  
Empty → `{ conventions: [] }`. Resolve failure → `toolError(error.error)`.

**Known gotcha:** `/repos/:repoId/conventions` takes a UUID — passing a name returns 400. Must resolve first.

---

#### T6 — Id-resolution helpers (application layer)
**Depends on:** T2 | **Parallel with:** T4, T3
**Owned paths:** `mcp-server/src/core/resolve.ts`

See [Id-Resolution Strategy](#id-resolution-strategy-srccoreresolve-ts) above.  
Returns structured `{ repoId } | { error: string }` — never throws.  
Onion: imports `client` (infrastructure) + `@devdigest/shared` only; zero tools/* or MCP SDK imports.

**Known gotcha:** `PrMeta.id` is `.nullish()` — guard before use; skip rows with `null` id.

---

#### T6b — Shared findings logic (application layer)
**Depends on:** T3 | **Parallel with:** T4, T5, T6
**Owned paths:** `mcp-server/src/core/findings.ts`

```ts
pickReview(reviews: ReviewRecord[], opts: { runId?: string }): ReviewRecord | undefined
// Filter kind === "review"; prefer runId match; else newest created_at

shapeFindings(review, { format, offset, limit }): {
  verdict, score, total, returned, offset,
  counts: { critical, warning, suggestion },
  findings: compactFinding[] | DetailedFinding[]
}
// concise: sort CRITICAL→WARNING→SUGGESTION, top-limit, compactFinding
// detailed: full FindingRecord fields, paginated
```

Pure functions, no I/O. Reused by both `get_findings` (T7) and `run_agent_on_pr` (T8).

**Known gotcha:** Filter `kind === "review"` — a PR may have multiple record types. `verdict` can be `null` on summary rows — guard it.

---

### Phase 2 — Blocking orchestration

#### T8a — `runReviewAndWait` (application layer)
**Depends on:** T2, T3, T6b | **Parallel with:** T7 (after T6b)
**Owned paths:** `mcp-server/src/core/run-review.ts`

```ts
type RunReviewResult =
  | { kind: 'done'; verdict: string; score: number | null; counts: Counts; findings: CompactFinding[] }
  | { kind: 'running'; run_id: string }
  | { kind: 'failed'; run_id: string; error: string }

async function runReviewAndWait(
  client: Client,
  { pullId, agentId }: { pullId: string; agentId: string },
  opts: { pollIntervalMs: number; runTimeoutMs: number },
  deps: { pickReview: typeof pickReview; shapeFindings: typeof shapeFindings }
): Promise<RunReviewResult>
```

**Algorithm:**
```
1. client.triggerReview(pullId, agentId) → run_id = runs[0].run_id
2. deadline = Date.now() + opts.runTimeoutMs
3. LOOP:
   a. await sleep(opts.pollIntervalMs)
   b. runs = await client.listRuns(pullId)
   c. target = runs.find(r => r.run_id === run_id)
   d. if !target OR status ∉ ['done','failed','cancelled']: continue (treat null/unknown as running)
   e. BREAK
   f. if deadline reached: return { kind: 'running', run_id }
4. if target.status === 'failed'/'cancelled': return { kind: 'failed', run_id, error: target.error ?? status }
5. reviews = await client.listReviews(pullId)
6. review = deps.pickReview(reviews, { runId: run_id })
7. if !review: return { kind: 'failed', run_id, error: 'Review completed but result not found' }
8. shaped = deps.shapeFindings(review, { format: 'concise', offset: 0, limit: 10 })
9. return { kind: 'done', ...shaped }
```

No MCP/SDK imports. No `toolOk`/`toolError` here — that mapping is the tool's job.

**Known gotcha:** POST is fire-and-forget (202); `reviews[]` in the trigger response is always `[]`. MUST poll. Rate-limited 10/min — one trigger per call, no retries on POST.

---

#### T7 — `devdigest_get_findings` (thin presentation)
**Depends on:** T6, T6b, T2, T3 | **Parallel with:** T8a
**Owned paths:** `mcp-server/src/tools/get-findings.ts`

Export `registerGetFindings(server, client, deps: { resolvePullId, pickReview, shapeFindings }): void`.  
Handler is **thin**: validate → `resolvePullId` → `client.listReviews(pullId)` → `pickReview(reviews, { runId })` → `shapeFindings(review, { format, offset, limit })` → `toolOk`.  
No review found → `toolError("No completed review yet — run devdigest_run_agent_on_pr first or wait and call devdigest_get_findings with the run_id.")`.

All selection/pagination/shaping lives in `core/findings.ts` (T6b). This file contains only wiring.

---

#### T8 — `devdigest_run_agent_on_pr` (thin presentation)
**Depends on:** T6, T6b, T8a, T2, T3
**Owned paths:** `mcp-server/src/tools/run-agent-on-pr.ts`

Export `registerRunAgentOnPr(server, client, deps: { resolvePullId, runReviewAndWait, pickReview, shapeFindings }): void`.

**Handler (thin):**
1. `resolvePullId(client, repo, pr)` → on error → `toolError(error.error)`
2. Validate `agent`: try match by id, fall back to case-insensitive name match against `client.listAgents()`. On miss → `toolError("Agent '${agent}' not found. Call devdigest_list_agents to see available agent ids.")`
3. Call `deps.runReviewAndWait(client, { pullId, agentId }, { pollIntervalMs, runTimeoutMs }, deps)`
4. Map result:
   - `kind: 'done'` → `toolOk({ verdict, score, counts, findings })`
   - `kind: 'running'` → `toolOk({ status: 'running', run_id, repo, pr, message: 'Review still running — call devdigest_get_findings with the same repo and pr later.' })`
   - `kind: 'failed'` → `toolError("Review run failed: ${error}. Check the DevDigest UI for trace details.")`

No polling logic in this file.

---

### Phase 3 — Stub tool

#### T9 — `devdigest_get_blast_radius` (STUB)
**Depends on:** T3 | **Parallel with:** T7, T8
**Owned paths:** `mcp-server/src/tools/get-blast-radius.ts`

Body: return `toolOk({ status: 'not_implemented', message: 'Blast radius not yet available — proceed without it, note the limitation.' })`.  
**Never throws. Never calls `fetch`.**

---

### Phase 4 — Entrypoint, registration, docs

#### T10 — Entrypoint (composition root)
**Depends on:** T4, T5, T7, T8, T9
**Owned paths:** `mcp-server/src/index.ts`

```ts
// 1. FIRST: redirect console.log/info to stderr (before any module side effects)
console.log  = (...args) => process.stderr.write(args.map(String).join(' ') + '\n');
console.info = (...args) => process.stderr.write(args.map(String).join(' ') + '\n');

// 2. imports + SDK
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// ... tools + core + http + config

// 3. Construct HTTP client
const client = createClient(config.apiUrl);

// 4. Build core deps (dependency injection — only place that wires)
const deps = { resolveRepoId, resolvePullId, pickReview, shapeFindings, runReviewAndWait };

// 5. Build McpServer + register all 5 tools
const server = new McpServer({ name: 'devdigest', version: '0.1.0' });
registerListAgents(server, client);
registerGetConventions(server, client, deps);
registerGetFindings(server, client, deps);
registerRunAgentOnPr(server, client, deps);
registerGetBlastRadius(server);

// 6. Connect transport
await server.connect(new StdioServerTransport());
```

**stdout guard:** The console.log/info redirect is the **first runtime statement** — before imports execute. This is the defense-in-depth layer on top of the grep gate.

**Graceful shutdown:**
```ts
process.once('SIGTERM', () => server.close().then(() => process.exit(0)));
process.once('SIGINT',  () => server.close().then(() => process.exit(0)));
```

**Acceptance:** `npm run start </dev/null` produces zero stdout output.

---

#### T11 — Project-scoped registration
**Depends on:** T10
**Owned paths:** `/.mcp.json`

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "npx",
      "args": ["tsx", "mcp-server/src/index.ts"],
      "env": {
        "DEVDIGEST_API_URL": "http://localhost:3001",
        "MCP_TOOL_TIMEOUT": "150000"
      }
    }
  }
}
```

`MCP_TOOL_TIMEOUT` (150s > 120s run timeout) prevents the client from killing the blocking `run_agent_on_pr` before it resolves.

**Acceptance:** `python3 -c "import json; json.load(open('.mcp.json'))"` parses without error.

---

#### T12 — README
**Depends on:** T11
**Owned paths:** `mcp-server/README.md`

Sections: prerequisites (`./scripts/dev.sh`), install, 5-tool reference table (args/returns/annotations), id-resolution note, 4 design principles honored, verification steps (MCP Inspector + `/mcp` in Claude Code).

---

## Parallelisation Map

```
T0 → T1 → ┬─ T2 → ┬─ T6 → ┬─ T5 ┐
           │       │       └─ T7 ─┤
           │       └─ T8a ──── T8 ─┤
           └─ T3 → ┬─ T4 ──────────┤
                   ├─ T6b ─ T7, T8 ┤
                   └─ T9 ───────────┤
                                    T10 → T11 → T12
```

---

## stdout/stderr Split

| What | Where | Why |
|------|-------|-----|
| JSON-RPC messages | stdout | MCP SDK writes automatically |
| Application logs | stderr | `log.ts` routes everything to `process.stderr` |
| Background review logs | server-side stderr (Fastify process) | HTTP transport — no background logging in MCP process |
| console.log/info redirect | `index.ts` line 1 | Defense-in-depth before any import side effects |
| Verification gate | `grep -rn "console.log(" mcp-server/src` → 0 results | CI/manual check |

---

## Error Handling Contract

```
Protocol-level (Zod):     Invalid/missing args → rejected before handler runs (SDK handles)
Business-level (isError):  Domain failures → return { content: [...], isError: true }
Empty result:              { agents: [] }, { conventions: [] } → toolOk, NOT isError

Forward-leading messages (all):
  Unknown agent  → "Call devdigest_list_agents to get valid agent ids."
  Unknown repo   → "Available: <full_name list>. Pass owner/name if ambiguous."
  PR not found   → "Open PRs in that repo: <numbers>."
  No review      → "Run devdigest_run_agent_on_pr first or wait and call get_findings with run_id."
  API down       → "Start it with ./scripts/dev.sh."
```

---

## Token-Efficiency Checklist

- [x] `list_agents` — returns `{id,name,enabled,model}` only; drops `system_prompt`, `description`, `version`
- [x] `run_agent_on_pr` — compact `{verdict, score, counts, findings[]}` with `compactFinding` (file:line + title + severity + rationale); never a raw `ReviewRecord` dump
- [x] `get_findings` — concise default (top-N + counts); detailed opt-in; offset/limit pagination
- [x] `get_conventions` — `{rule,file,confidence,accepted}`; drops `evidence_snippet`
- [x] `get_blast_radius` — tiny fixed payload
- [x] All descriptions ≤50 words (tool name is token-free once registered)
- [x] `devdigest_*` namespace keeps names distinct at the cost of ~10 tokens each — acceptable at 5 tools
- [x] `title` field (UI-only, not in LLM context) can be verbose; `description` is the token budget

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Two list calls per resolution (name→id) | Acceptable for local dev; lists are small. Add short-lived in-process cache later if needed. |
| Review exceeds 120s | Designed fallback: `{status: "running", run_id}`; `MCP_TOOL_TIMEOUT=150000` in `.mcp.json` |
| `status` is nullable free-form string | Treat only `done` as success; everything else → still-running (capped by timeout) |
| Ambiguous bare repo name | Resolver returns forward-leading error asking for `owner/name` |
| Rate limit (10/min) on review trigger | One trigger per `run_agent_on_pr` call; no POST retries |
| stdout corruption | Console patch in `index.ts` + grep gate; zero-stdout verified before merge |
| Stale `agent_runs` row on MCP process crash | Server's `reapStaleRunningRuns()` runs on next Fastify boot. Not fixed here — acceptable for local dev. |
| `LocalNoAuthProvider` coupling | If DevDigest adds real auth, the MCP server would need workspace id passed via env. Noted for future. |

---

## Global Definition of Done

- [ ] `npm run typecheck` exits 0 in `mcp-server/`
- [ ] `grep -rn "console.log(" mcp-server/src` returns 0 results
- [ ] `npm run start </dev/null` produces no stdout before the SDK sends its first JSON-RPC message
- [ ] MCP Inspector shows all 5 tools with correct names, schemas, and annotations
- [ ] `devdigest_list_agents` returns `{agents:[...]}` matching `GET /agents`
- [ ] `devdigest_run_agent_on_pr` with valid args blocks and returns `{verdict, findings[]}`
- [ ] `devdigest_get_findings` with `response_format:"detailed"` returns full fields
- [ ] `devdigest_get_blast_radius` returns `{status:"not_implemented"}` with no `isError`
- [ ] `.mcp.json` parses as valid JSON; `claude mcp list` / `/mcp` shows `devdigest` connected
- [ ] All existing server + client tests pass (no changes to those packages)
