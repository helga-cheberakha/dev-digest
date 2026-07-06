# DevDigest MCP Server

A local stdio [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes DevDigest's AI PR-review capabilities to Claude Code and other MCP clients. It communicates with the DevDigest API over HTTP and surfaces 5 tools the model can call during a conversation. The package also ships the `devdigest` console command for reviewing local diffs before opening a PR (see [CLI: `devdigest review`](#cli-devdigest-review)).

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

## CLI: `devdigest review`

Besides the MCP tools, this package ships the `devdigest` console command — a local
pre-review gate that runs the same Structured Reviewer from `@devdigest/reviewer-core`
against your uncommitted changes **before you open a PR**. It works fully offline from
the DevDigest stack: no API server, no database — only an LLM API key.

### One-time setup

```bash
cd mcp-server
npm install
npm link        # puts `devdigest` on your PATH
```

Provide an API key either as an environment variable (`OPENROUTER_API_KEY`,
`OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`) or in the DevDigest secrets file
(`~/.devdigest/secrets.json`, overridable via `DEVDIGEST_SECRETS_PATH`).

### Usage

Run it from inside any git repository (any subdirectory works):

```bash
# review unstaged working-copy changes with the defaults
devdigest review --mode working

# stricter gate: fail on any finding, full rationale text
devdigest review --mode working --fail-on any --verbose

# different provider/model
devdigest review --provider openai --model gpt-4.1
```

| Flag | Values | Default |
|---|---|---|
| `--mode` | `working` \| `staged`* \| `branch`* | `working` |
| `--provider` | `openrouter` \| `openai` \| `anthropic` | `openrouter` |
| `--model` | any model id the provider serves | `deepseek/deepseek-v4-flash` |
| `--fail-on` | `critical` \| `warning` \| `any` \| `never` | `critical` |
| `--verbose` | — | off (rationale truncated to 300 chars) |

\* `staged` and `branch` are reserved and not implemented yet.

Findings go to **stdout**; progress and the token/cost summary go to **stderr**, so you
can pipe stdout cleanly in scripts or a pre-push hook.

Exit codes: `0` clean (or empty diff) · `1` at least one finding tripped the
`--fail-on` gate · `2` runtime error (not a git repo, missing API key, model
unavailable, …).

Notes:
- The system prompt is a built-in generic review prompt — it does not use your studio
  agent's DB-stored prompt (the CLI has no DB connection).
- Large diffs are automatically map-reduced file by file.
- If the model id is not served by OpenRouter (404 "No endpoints found"), the CLI
  prints a hint to pass `--model <id>` or check https://openrouter.ai/models.

## Verification

1. Start the API: `cd server && npm run dev`
2. In Claude Code, ask: *"list devdigest agents"* — should return agent list
3. Run a review: *"run devdigest agent `<name>` on PR #42 in repo `owner/name`"*

## Development

```bash
# Type-check
npm run typecheck

# Run tests
npm test

# Run directly (for manual testing / debugging)
npm start
```

> **stdout is the JSON-RPC stream.** Never use `console.log` in this package — it silently corrupts the MCP protocol. All logging goes to stderr via `src/log.ts`.
