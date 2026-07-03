# Insights — mcp-server

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

- **2026-06-30** — Fire-and-forget + poll for review execution: `POST /pulls/:id/review` returns immediately with an empty `reviews[]`; poll `GET /pulls/:id/runs` until status is `done|failed|cancelled`; null/unknown status = still running. On timeout return `{ kind: 'running', run_id }` (not an error) so the caller can retry via `devdigest_get_findings`. Evidence: `mcp-server/src/core/run-review.ts:40-75`.

## What Doesn't Work

- **2026-06-30** — Any `console.log` call in stdio MCP transport silently corrupts the JSON-RPC stream — no error is thrown, responses simply stop making sense or the client disconnects. All logging must go to stderr. Use the `log` helper in `src/log.ts` (writes to `process.stderr`). Never use `console.*` anywhere in this package. Evidence: `mcp-server/src/log.ts`, `mcp-server/src/index.ts`.
- **2026-06-30** — Zod `.default(N)` on a tool input field means the value is **always** present in the handler (never `undefined`), making any `?? fallback` in the handler body permanently dead code. The fix is `.optional()` in the schema and an explicit `const resolved = value ?? defaultN` in the handler. Discovered when `limit: z.number().default(10)` made the `?? 20` for detailed-mode findings unreachable. Evidence: `mcp-server/src/tools/get-findings.ts`.

## Codebase Patterns

- **2026-06-30** — Id resolution follows list-then-match: the DevDigest API has no direct lookup-by-name endpoint. Must call `GET /repos`, match by `full_name`, `name`, or `owner/name`, then `GET /repos/:id/pulls` and match by PR number. `resolvePullId()` encapsulates both steps and never throws — it returns `{ error: string }` for domain failures. Evidence: `mcp-server/src/core/resolve.ts`.
- **2026-06-30** — Onion layer discipline: `tools/` (presentation) → `core/` (application logic) → `http/client.ts` (infrastructure). `core/` files import from `http/client.js` and other `core/` files but must never import from `tools/` or the MCP SDK. The composition root `index.ts` is the only file that knows all layers.

## Tool & Library Notes

- **2026-06-30** — `@modelcontextprotocol/sdk` v1.29.0: the `description` field on a tool goes into the LLM's context window (keep ≤50 words); `title` is UI-only. Domain errors should return `{ content, isError: true }` (use `toolError()`); protocol errors (programmer mistakes) should `throw`. Mixing them up causes the client to either silently ignore a domain error or crash on a recoverable one. Evidence: `mcp-server/src/format.ts`.

## Recurring Errors & Fixes

- **2026-07-03** — `/mcp` shows `Failed to reconnect to devdigest: -32000` because Claude Code does **not** honor the `cwd` field in `.mcp.json` stdio configs — it spawns the command from the project root, so `npx tsx src/index.ts` with `"cwd": "./mcp-server"` dies with `ERR_MODULE_NOT_FOUND` before the handshake. Fix: drop `cwd` and use root-relative paths for both the binary and the entry file: `"command": "./mcp-server/node_modules/.bin/tsx", "args": ["./mcp-server/src/index.ts"]`. Verified by piping an `initialize` request manually from both cwds. Evidence: `.mcp.json`, `mcp-server/src/index.ts:26`.

## Session Notes

### 2026-06-30
- Built `mcp-server/` package from scratch: 5 MCP tools (`devdigest_list_agents`, `devdigest_run_agent_on_pr`, `devdigest_get_findings`, `devdigest_get_conventions`, `devdigest_get_blast_radius` stub).
- Architecture: `@modelcontextprotocol/sdk` v1.29.0, stdio transport, `createClient()` HTTP facade, onion layers (tools/ → core/ → http/).
- Added `.mcp.json` at project root for Claude Code auto-registration; timeout 150 000 ms.
- TypeScript clean (`npx tsc --noEmit` zero errors).

## Open Questions
