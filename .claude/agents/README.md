# DevDigest Agents

Custom subagents for the DevDigest project. Each agent is a Markdown file with YAML frontmatter
that defines its name, model, tools, and preloaded skills — the body is the system prompt.

---

## planner

**File:** `planner.md`

**Purpose:** Analyses a feature request or bug fix, reads the project structure and all
INSIGHTS.md files, and produces a structured implementation plan written to `docs/plans/`.
The plan is the contract that implementer agents execute against.

**Key behaviour:**
- Reads INSIGHTS.md and AGENTS.md for every touched module before writing anything.
- Verifies that every stated requirement maps to at least one task.
- Builds a file-conflict matrix so parallel implementer instances never touch the same file.
- Writes only to `docs/plans/PLAN-<feature>.md` — never writes source code.
- Bash is read-only (`grep`, `find`, `ls`, `cat`, `head`, `tail`, `wc`, `git log/diff/status`).

**Model:** `claude-sonnet-4-6`

**Tools:** Read · Bash · Write

**Preloaded skills:**
`drizzle-orm-patterns` · `fastify-best-practices` · `onion-architecture` · `typescript-expert` ·
`zod` · `postgresql-table-design` · `security` · `frontend-architecture` · `react-best-practices` ·
`next-best-practices` · `react-testing-library` · `mermaid-diagram`

---

## implementer

**File:** `implementer.md`

**Purpose:** Receives one task from a planner-produced plan and brings it to green — writes
source code, verifies TypeScript compiles (`npx tsc --noEmit`), and confirms the task's tests
pass. Multiple implementer instances can run in parallel on the same branch; each touches only
the files the planner assigned to it.

**Key behaviour:**
- Reads the relevant module's INSIGHTS.md first and states the 3 most relevant points.
- Follows the plan's Approach steps in order; does not deviate or refactor neighbours.
- Stops and reports a blocker if it needs to touch a file not in its task list.
- Returns a structured completion report with files changed, test results, and any blockers.
- Never runs `git push`, `git commit`, `rm`, or destructive resets.

**Model:** `claude-sonnet-4-6`

**Tools:** Read · Bash · Edit · Write

**Preloaded skills:**
`drizzle-orm-patterns` · `fastify-best-practices` · `onion-architecture` · `typescript-expert` ·
`zod` · `postgresql-table-design` · `security` · `frontend-architecture` · `react-best-practices` ·
`next-best-practices` · `react-testing-library`

---

## researcher

**File:** `researcher.md`

**Purpose:** Finds information by searching the project codebase (docs, specs, INSIGHTS.md,
source files) and/or the internet. Always interviews the user with up to 3 clarifying questions
before starting. Read-only — never creates, edits, or deletes files.

**Key behaviour:**
- Phase 1 (interview): asks scope, depth, format preference, prior knowledge, and purpose.
- Phase 2 (research): searches `docs/` → INSIGHTS.md → AGENTS.md → source files, then internet.
- Phase 3 (output): returns findings with precise `file:line` citations for project claims and
  URLs for internet claims, plus an explicit "Not Found" table for anything missing.
- Bash is strictly read-only (`grep`, `find`, `ls`, `cat`, `head`, `tail`, `wc`).
- Does not use deep research mode.

**Model:** `claude-sonnet-4-6`

**Tools:** Read · Bash · WebSearch · WebFetch

---

---

## test-writer

**File:** `test-writer.md`

**Purpose:** Writes and extends test suites for UI (React/Next.js with RTL and Vitest) and
backend (Fastify with app.inject). Reads source + existing tests + coverage before writing.
Produces a test plan first, then implements and verifies tests pass.

**Key behaviour:**
- Phase 1 (Discovery): reads source, existing tests, coverage report, and module INSIGHTS.md before writing a single line.
- Phase 2 (Boundary analysis): enumerates boundary cases and produces a numbered test plan shown in the response before any code is written.
- Phase 3 (Implementation): writes tests following the plan; hardcodes all expected values; mocks collaborators via DI/MSW — never mocks the module under test.
- Phase 4 (Verification): runs `npm test`; all new tests must be green; pre-existing failures disclosed but not fixed.

**Model:** `claude-sonnet-4-6`

**Tools:** Read · Bash · Edit · Write

**Preloaded skills:**
`react-testing-library` · `fastify-best-practices` · `typescript-expert` · `security` · `frontend-architecture` · `react-best-practices` · `next-best-practices`

---

## architecture-reviewer

**File:** `architecture-reviewer.md`

**Purpose:** Reviews software architecture for layer violations, coupling, security surface,
data consistency, scaling limits, observability, and operational cost. Read-only — no Edit, no
Write. Produces a Concern Matrix table followed by per-finding details with file:line citations
and severity ratings.

**Key behaviour:**
- Five-phase sequential analysis: Discovery → Flow tracing → Draft modeling → Scoring → Findings report.
- Covers seven concern dimensions: failure modes, data consistency, scaling limits, security surface, coupling, observability, operational cost.
- CRITICAL and HIGH findings block merge; all findings must cite `file:line`.
- Strictly read-only: Bash limited to `grep`, `find`, `git log`, `git diff`, `git status`, `git show`.
- HIGH severity + LOW confidence findings downgraded to MEDIUM or phrased as questions.

**Model:** `claude-sonnet-4-6`

**Tools:** Read · Bash

**Preloaded skills:**
`onion-architecture` · `typescript-expert` · `security` · `fastify-best-practices` · `drizzle-orm-patterns` · `postgresql-table-design` · `frontend-architecture` · `react-best-practices` · `next-best-practices` · `mermaid-diagram` · `code-review-conventions`

---

## plan-verifier

**File:** `plan-verifier.md`

**Purpose:** Reads a development plan from `docs/plans/` and checks the current implementation
state against it. Classifies each task as COMPLETE, DRIFT, or VIOLATION. Produces a Markdown
checklist and JSON summary block. Read-only.

**Key behaviour:**
- Evidence-first verification: consults git log → file tree → TypeScript exports → test existence → content spot-check in priority order; never infers completion from proximity.
- Three-way classification: COMPLETE (all checks pass), DRIFT (intent fulfilled via different approach — human decision required), VIOLATION (required artifact absent — hard fail).
- Scope creep detection: compares all changed files against the union of task "Files to touch" lists and flags anomalies.
- JSON summary block in every report: includes `total`, `completed`, `violations`, `drift_items`, `percent_complete`, `incomplete_tasks`.

**Model:** `claude-sonnet-4-6`

**Tools:** Read · Bash

**Preloaded skills:**
`typescript-expert` · `drizzle-orm-patterns` · `fastify-best-practices` · `onion-architecture` · `react-best-practices` · `next-best-practices`

---

## doc-writer

**File:** `doc-writer.md`

**Purpose:** Writes ADRs, feature docs, API reference, runbooks, development plans, and Mermaid
architecture diagrams. Reads actual TypeScript types and Zod schemas before writing any API shape.
Writes only to `docs/`.

**Key behaviour:**
- Mandatory discovery before writing: reads `docs/`, `specs/`, `INSIGHTS.md`, `AGENTS.md`, TypeScript types, Zod schemas, tests, and git log before producing any content.
- Doc type routing table: ADRs → `docs/adr/`, feature docs → `docs/features/`, API reference → `docs/api/`, runbooks → `docs/runbooks/`, plans → `docs/plans/`, architecture diagrams → `docs/architecture/`.
- Mandatory templates per type: ADR, API reference, and runbook each have fixed required sections; all must be followed exactly.
- ADR append-only discipline: accepted ADRs are never edited; superseding requires a new ADR with the old one updated to `SUPERSEDED by ADR-NNN`.
- Mermaid-only diagrams: all diagrams are Mermaid code blocks — no external images or links.

**Model:** `claude-sonnet-4-6`

**Tools:** Read · Bash · Write

**Preloaded skills:**
`mermaid-diagram` · `typescript-expert` · `frontend-architecture` · `react-best-practices` · `next-best-practices` · `fastify-best-practices` · `onion-architecture` · `drizzle-orm-patterns` · `security`

---

## Usage pattern

```
1. Spawn planner → produces docs/plans/PLAN-<feature>.md
2. Spawn one implementer per task (parallel where the plan allows)
3. Spawn researcher any time you need to locate a concept or gather context
4. Spawn plan-verifier after all implementer tasks complete to confirm the plan is fulfilled
5. Spawn architecture-reviewer before merge for deep architectural analysis
6. Spawn test-writer to add or extend tests for any module
7. Spawn doc-writer to produce ADRs, API reference, runbooks, or feature docs
```

To invoke an agent from Claude Code:

```
/agent planner               implement user notifications
/agent implementer           execute task T1 from docs/plans/PLAN-notifications.md
/agent researcher            how does the SSE bus work in this project?
/agent test-writer           write tests for server/src/modules/skills/service.ts
/agent architecture-reviewer review the server module architecture
/agent plan-verifier         verify docs/plans/PLAN-notifications.md
/agent doc-writer            write API reference for the skills module
```
