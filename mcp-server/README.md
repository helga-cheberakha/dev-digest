# DevDigest MCP Server

A local stdio [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes DevDigest's AI PR-review capabilities to Claude Code and other MCP clients. It communicates with the DevDigest API over HTTP and surfaces 5 tools the model can call during a conversation.

## Prerequisites

- Node.js 20+
- DevDigest API running locally (see `server/README.md`)

## Installation

```bash
cd mcp-server
npm install
```

## Configuration

The project root already ships a `.mcp.json` that Claude Code picks up automatically when you open the project:

```json
{
  "mcpServers": {
    "devdigest": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "./mcp-server",
      "env": { "DEVDIGEST_API_URL": "http://localhost:3001" },
      "timeout": 150000
    }
  }
}
```

No manual registration is needed — restart Claude Code after `npm install` and the `devdigest_*` tools appear automatically.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | Base URL of the DevDigest API |

## Tools

### `devdigest_list_agents`
Lists available AI review agents. Optionally filter to agents configured for a specific repo.

| Arg | Type | Required | Description |
|---|---|---|---|
| `repo` | string | No | Repo as `owner/name` or just `name` |

---

### `devdigest_run_agent_on_pr`
Runs an AI agent on a PR and waits for the result (up to 120 s). Returns verdict, score, and top findings.

| Arg | Type | Required | Description |
|---|---|---|---|
| `repo` | string | Yes | Repo as `owner/name` or just `name` |
| `pr` | number | Yes | PR number |
| `agent` | string | Yes | Agent id or name (from `devdigest_list_agents`) |

---

### `devdigest_get_findings`
Retrieves findings from the most recent (or a specific) completed review without triggering a new run.

| Arg | Type | Required | Description |
|---|---|---|---|
| `repo` | string | Yes | Repo as `owner/name` or just `name` |
| `pr` | number | Yes | PR number |
| `run_id` | string | No | Specific run id; omit for latest |
| `response_format` | `"concise"` \| `"detailed"` | No | Default `"concise"` |
| `offset` | number | No | Pagination offset (default 0) |
| `limit` | number | No | Max findings (default 10 concise / 20 detailed) |

---

### `devdigest_get_conventions`
Returns code conventions discovered by the repo-intel pipeline for a repository.

| Arg | Type | Required | Description |
|---|---|---|---|
| `repo` | string | Yes | Repo as `owner/name` or just `name` |

---

### `devdigest_get_blast_radius`
*(Stub — not yet implemented)* Will return the blast radius of a PR change.

| Arg | Type | Required | Description |
|---|---|---|---|
| `repo` | string | Yes | Repo as `owner/name` or just `name` |
| `pr` | number | Yes | PR number |

## Verification

1. Start the API: `cd server && npm run dev`
2. In Claude Code, ask: *"list devdigest agents"* — should return agent list
3. Run a review: *"run devdigest agent `<name>` on PR #42 in repo `owner/name`"*

## Development

```bash
# Type-check
npm run typecheck

# Run directly (for manual testing / debugging)
npm start
```

> **stdout is the JSON-RPC stream.** Never use `console.log` in this package — it silently corrupts the MCP protocol. All logging goes to stderr via `src/log.ts`.
