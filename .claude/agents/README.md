# DevDigest Agents

Custom subagents for the DevDigest project. Each agent is a Markdown file with YAML frontmatter
that defines its name, model, tools, and preloaded skills — the body is the system prompt.

---

## implementation-planner

**File:** `implementation-planner.md`

**Purpose:** Analyses a feature request or bug fix (or an approved spec from `specs/`), reads
the project structure and all INSIGHTS.md files, and produces a structured implementation plan
written to `docs/plans/`. The plan is the contract that implementer agents execute against.
Does **not** write specifications — that is `spec-creator`'s job.

**Key behaviour:**
- Verifies requirements first: flags ambiguous/untestable/conflicting ones and recommends
  improvements to the requested approach.
- **One question round**: all blocking clarifications plus the execution-mode question
  (multi-agent parallel vs single-agent sequential) go into a single AskUserQuestion call
  (max 4 questions) — never multiple rounds.
- Reads `<module>/INSIGHTS.md` for every touched module before writing anything; folds relevant
  traps into each task's `Known gotchas`.
- Verifies that every stated requirement maps to at least one task; every task carries a
  `Covers:` field with the spec AC IDs it fulfils (traceability for plan-verifier).
- Non-overlapping `Owned paths` so parallel implementer instances never touch the same file
  (multi-agent mode only).
- Writes only to `docs/plans/PLAN-<kebab-feature-name>.md` — never writes source code, never
  touches `specs/`.
- Bash is read-only (`grep`, `find`, `ls`, `cat`, `git log/diff/status`); never runs
  `npm test` / `npx tsc` — baseline verification belongs to the implementer.

**Model:** `opus`

**Tools:** Read · Glob · Grep · Bash · Agent · Write · AskUserQuestion

**Preloaded skills:**
`onion-architecture` · `fastify-best-practices` · `drizzle-orm-patterns` ·
`postgresql-table-design` · `zod` · `frontend-architecture` · `next-best-practices` ·
`react-best-practices` · `react-testing-library` · `typescript-expert` · `security` ·
`engineering-insights` · `mermaid-diagram`

---

## implementer

**File:** `implementer.md`

**Purpose:** Receives one task from an implementation-planner-produced plan and brings it to
green — writes source code, verifies TypeScript compiles (`npx tsc --noEmit`), and confirms the
task's tests pass. Multiple implementer instances can run in parallel on the same branch; each
touches only the files the implementation-planner assigned to it.

**Key behaviour:**
- Reads the relevant module's INSIGHTS.md first and states the 3 most relevant points.
- Follows the task's `Action` steps in order; touches only its `Owned paths`; does not deviate
  or refactor neighbours.
- Stops and reports a blocker if it needs to touch a file not in its task list.
- Returns a structured completion report with files changed, test results, and any blockers.
- Never runs `git push`, `git commit`, `rm`, or destructive resets.
- **Generic profile** — used for tasks spanning backend and frontend. For single-sided tasks the
  orchestrator prefers the cheaper specialised profiles below.

**Model:** `claude-sonnet-4-6`

**Tools:** Read · Bash · Edit · Write

**Preloaded skills:**
`drizzle-orm-patterns` · `fastify-best-practices` · `onion-architecture` · `typescript-expert` ·
`zod` · `postgresql-table-design` · `security` · `frontend-architecture` · `react-best-practices` ·
`next-best-practices` · `react-testing-library`

---

## implementer-backend

**File:** `implementer-backend.md`

**Purpose:** Backend profile of `implementer` — same contract and workflow, trimmed skill set.
Spawn for plan tasks with `Type: backend | core` (`server`, `reviewer-core`). Each parallel
instance loads only the backend skills, cutting per-instance token cost.

**Model:** `claude-sonnet-4-6` · **Tools:** Read · Bash · Edit · Write

**Preloaded skills:**
`drizzle-orm-patterns` · `fastify-best-practices` · `onion-architecture` · `typescript-expert` ·
`zod` · `postgresql-table-design` · `security`

---

## implementer-ui

**File:** `implementer-ui.md`

**Purpose:** Frontend profile of `implementer` — same contract and workflow, trimmed skill set.
Spawn for plan tasks with `Type: ui | e2e` (`client`, `e2e`). Each parallel instance loads only
the frontend skills, cutting per-instance token cost.

**Model:** `claude-sonnet-4-6` · **Tools:** Read · Bash · Edit · Write

**Preloaded skills:**
`frontend-architecture` · `react-best-practices` · `next-best-practices` ·
`react-testing-library` · `typescript-expert` · `zod` · `security`

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

## test-writer — **DISABLED**

**File:** `test-writer.md.disabled` (rename back to `test-writer.md` to re-enable)

> Disabled 2026-07-07 to save tokens. Test coverage comes from each plan task's Acceptance
> (implementers write and run the tests their task specifies) plus the `/pr-self-review` gate.
> Do not spawn this agent; `/implement` never uses it.

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
- **Default scope = the branch diff** (`git diff main...HEAD` plus one-hop imports); a full
  whole-codebase audit runs only on explicit request. The report header states the scope.
- Five-phase sequential analysis: Discovery → Flow tracing → Draft modeling → Scoring → Findings report.
- Covers seven concern dimensions: failure modes, data consistency, scaling limits, security surface, coupling, observability, operational cost.
- CRITICAL and HIGH findings block merge; all findings must cite `file:line`.
- Strictly read-only: Bash limited to `grep`, `find`, `git log`, `git diff`, `git status`, `git show`.
- HIGH severity + LOW confidence findings downgraded to MEDIUM or phrased as questions.

**Model:** `sonnet` (alias — always the latest Sonnet; deliberately not Opus for cost)

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
- Evidence-first verification: consults git log (orchestrator phase commits with task IDs) → file tree → TypeScript exports → test existence → content spot-check in priority order; never infers completion from proximity.
- Three-way classification: COMPLETE (all checks pass), DRIFT (intent fulfilled via different approach — human decision required), VIOLATION (required artifact absent — hard fail).
- **Never runs tests**: for test tasks it verifies the test file exists and contains the described `describe`/`it` blocks; "green" is attested by implementer reports and `/pr-self-review`.
- **Spec coverage check**: every `AC-N` from the cited spec must appear in at least one task's `Covers` field; uncovered ACs fail the verdict.
- Scope creep detection: compares all changed files against the union of task "Owned paths" lists and flags anomalies.
- JSON summary block in every report: includes `total`, `completed`, `violations`, `drift_items`, `uncovered_acs`, `percent_complete`, `incomplete_tasks`.

**Model:** `sonnet` (alias — always the latest Sonnet; deliberately not Opus for cost)

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

## spec-creator

**File:** `spec-creator.md`

**Purpose:** Spec Driven Development entry point — turns a feature request plus design
materials (Figma/external links via WebFetch, screenshots via Read, text descriptions) into a
specification with EARS acceptance criteria. The spec is the contract that implementation-planner
and implementer agents execute against.

**Key behaviour:**
- Writes **only** inside `specs/` directories: one affected package → that package's `specs/`;
  cross-package features → root `specs/`. Never writes source code, docs, or plans.
- Spec ID = date + feature name: `SPEC-YYYY-MM-DD-<feature>` (file name matches); detects
  duplicates and handles supersedes both ways (new spec gets `Supersedes:`, old one gets
  `Superseded by <new ID>`).
- Grounds the spec before writing: module `docs/`, existing `specs/`, and the
  `<module>/INSIGHTS.md` of the affected modules only; fans out parallel `researcher`
  sub-agents for broad exploration strands.
- May include Mermaid workflow/sequence diagrams and interface-level contracts (endpoints,
  event payloads, field tables) — never implementation details or code.
- Fixed template (spec file written in English): Problem & why / Goals-Non-goals /
  User stories / Inputs (provenance) / Acceptance criteria (EARS, AC-n IDs) / Edge cases /
  Non-functional (incl. Success signal) / Cross-module interactions / Contracts /
  Untrusted inputs / Assumptions / Proposals ([PROPOSAL]) / Open questions
  ([NEEDS CLARIFICATION]).
- Question triage: **blocking** questions are asked first (AskUserQuestion), before any file
  is written; assumable points get a default recorded under Assumptions; non-blocking ones go
  inline into `[NEEDS CLARIFICATION]` and the draft is written anyway.
- Design analysis hunts for what the design does not say: uncovered corner cases, module
  interactions, UX gaps — out-of-scope improvements returned as explicit [PROPOSAL] items.
- Bash is read-only; new specs always start as `Status: draft` (human flips to `approved`,
  caller/plan-verifier to `implemented`).

**Model:** `opus`

**Tools:** Read · Glob · Grep · Bash · WebFetch · Write · Edit · Agent · AskUserQuestion

**Preloaded skills:**
`security` · `onion-architecture` · `frontend-architecture` · `fastify-best-practices` ·
`react-best-practices` · `next-best-practices` · `typescript-expert` · `zod` ·
`drizzle-orm-patterns` · `postgresql-table-design` · `mermaid-diagram`

---

## Orchestration protocol

Stages 0–1 run **manually** (each in its own chat); the execution stage (2–5) is automated by the
**`/implement`** skill (`.claude/skills/implement/SKILL.md`).

```
MANUAL
0. Spawn spec-creator → produces specs/SPEC-YYYY-MM-DD-<feature>.md (answer its questions,
   a human flips Status to approved)
1. Spawn implementation-planner → verifies requirements, asks ONE combined question round
   (clarifications + single- vs multi-agent mode) → produces docs/plans/PLAN-<feature>.md

AUTOMATED — /implement plan:<path> [mode:multi|single] [max-fix:<n>] [free-text run notes]
2. Executes the plan batch by batch, respecting the dependency DAG:
   - Type backend | core → implementer-backend
   - Type ui | e2e      → implementer-ui
   - task spans both     → generic implementer
   Parallel tasks within a batch run concurrently (non-overlapping Owned paths).
   ► After each batch/phase the orchestrator COMMITS with the task IDs in the message,
     e.g. `[PLAN-<feature>] Phase 1: T1, T2` — plan-verifier's #1 evidence signal, and the
     only way the work lands in the `main...HEAD` diff that architecture-reviewer reads.
3. Review gate — architecture-reviewer AND plan-verifier run in parallel (both read-only,
   both Sonnet; test-writer is DISABLED — tests come from task Acceptance + pr-self-review).
   Reviewer PASS = zero CRITICAL/HIGH findings; verifier verdict = PASS / FAIL / REVIEW NEEDED.
4. Bounded fix loop (default max-fix: 3): backlog = reviewer CRITICAL/HIGH findings +
   verifier VIOLATIONs, grouped into non-overlapping fix dispatches → matching implementer
   profile → commit `[PLAN-<feature>] review fixes (<i>): …` → re-review the touched scope
   only. MEDIUM/LOW recorded, never auto-fixed. DRIFT and uncovered ACs go to a human,
   never into the loop. No progress or cap reached → stop for a human decision.
5. The run ends with a recommendation to run /pr-self-review (skill) — the final
   deterministic gate (typecheck, tests, lint). /implement never pushes or opens the PR.

OPTIONAL / ANY TIME
6. Spawn doc-writer for ADRs, API reference, runbooks, or feature docs.
   Spawn researcher at any point to locate a concept or gather context.
```

To invoke from Claude Code:

```
/agent spec-creator          write a spec for onboarding overview (designs: docs/design/…)
/agent implementation-planner plan implementation of user notifications
/implement plan:docs/plans/PLAN-notifications.md
/implement plan:docs/plans/PLAN-notifications.md mode:single max-fix:2 skip phase 3 for now
/agent researcher            how does the SSE bus work in this project?
/agent architecture-reviewer review the current branch diff (default scope)
/agent plan-verifier         verify docs/plans/PLAN-notifications.md
/agent doc-writer            write API reference for the skills module
```

Single tasks can still be dispatched by hand when debugging a run:
`/agent implementer-backend execute task T1 from docs/plans/PLAN-notifications.md`.
