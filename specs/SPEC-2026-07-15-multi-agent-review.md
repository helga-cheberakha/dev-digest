# Spec: Multi-Agent Review — live review by multiple agents in parallel   |   Spec ID: SPEC-2026-07-15-multi-agent-review   |   Status: draft
Supersedes: none

## Problem & why
A real PR is heterogeneous: security, performance, and domain-logic concerns are mixed together. Today
the reviewer runs **one focus at a time** — the `RunReviewDropdown` lets a user run a single agent or
"all enabled agents", but there is no first-class way to pick a specific *set* of specialist agents,
watch them work in parallel, and compare their findings side by side. That forces the user to choose an
angle up front and re-run for each other angle.

Running several specialists at once creates three new needs this feature must serve:

1. **Duplication is corrosive.** Three agents independently reporting the same obvious bug, shown as
   three separate findings, makes the tool feel noisy and untrustworthy. Findings that land on the same
   code location must be grouped across agents.
2. **Blind waiting is worse with more agents.** Fanning out N agents behind a single spinner for minutes
   gives no feedback. Per-agent live status is required.
3. **Attribution is forward-looking raw material.** "Which agent found this" must survive in the data
   model to feed a future Per-Agent Stats feature — even though that feature is out of scope here.

The parallel-execution engine, the run trace/live-log, and the multi-agent *contract shapes* already
exist (see *Contracts*). What is missing is the product surface on top of them: an agent picker, a
Configure-run page with pre-run estimates, a persistence layer that groups the fan-out under one parent
run, cross-agent finding grouping, and a two-mode results page.

**Design source.** This spec is grounded in five confirmed design screens (`ma-config-empty`,
`ma-config`, `ma-cols`, `ma-tabs`, plus the PR-page picker inside the `core`/`pr-overview` screen) —
verified directly against the design file's component source (`ScreenMultiAgent`, `RunConfig`,
`ConflictsSection`, `MetaRow`, `RunReviewDropdown`), not only rendered screenshots. There is no sixth
"trace sidebar open" screen in the design — the "View trace" affordance is rendered as a static,
unwired label (`window.MonoLink`) with no click handler in the mockup. Wiring it to the real trace
viewer is new work this spec requires (see US-6, AC-21, AC-27).

## Goals / Non-goals
- **Goal:** Replace `RunReviewDropdown` on the PR page with an agent *picker* that lets the user check a
  specific set of agents and launch a multi-agent review of that set.
- **Goal:** A dedicated Configure-run page to pick a PR and agents, each row showing a time·cost estimate
  sourced from that agent's past runs, plus a pre-run summary estimate line.
- **Goal:** Persist a parent multi-agent-run record that groups the individual per-agent runs, so the
  fan-out is addressable as one unit and per-finding agent attribution is retained.
- **Goal:** Group findings from different agents that land on the same code location into a shared
  "Where agents disagree" card, including an explicit "did not flag" state for agents that reviewed the
  location but did not flag it, and a "Show only conflicts" filter.
- **Goal:** A results page with two switchable modes — Columns (one live column per agent) and
  Tabs+detail (per-agent finding detail with action buttons) — sharing the "Where agents disagree" block.
- **Goal:** Surface live per-agent status in the Columns headers and a working "View trace" link on every
  agent column/tab that opens the **existing** `RunTraceDrawer` (720px drawer) for that agent's run —
  its Trace tab (Configuration / Stats / Findings / Prompt assembly / Tool calls / Raw output sections,
  with a "Copy Raw Output" footer action) and its Live-log tab (SSE-streamed `LiveLogStream`) are reused
  as-is. This feature does not modify the drawer; it only ensures every agent surface links into it.
- **Non-goal:** Modifying the parallel-execution engine — `ci/`, `agent-runner/`, the run-executor, and
  per-agent worktree/failure-isolation are **fixed contracts to call, not to change**.
- **Non-goal:** Modifying the trace/live-log engine (SSE replay buffer, `RunTraceDrawer`,
  `LiveLogStream`, its tab set). This feature only *links into* it.
- **Non-goal:** Building the Per-Agent Stats page (the `AgentStats` contract already exists but stays
  unused here — we only preserve the attribution it will later read).
- **Non-goal:** The Compose-Review drawer (curates findings before publishing) — a separate,
  already-designed feature (`pr-compose` screen).
- **Non-goal:** Implementing the "Learn"/Memory feature — the button is wired as a hook only.
- **Non-goal:** Reimplementing "Turn into eval case" — it bridges to the existing Lesson-06 eval-case
  capability (`POST /findings/:id/eval-case` + the eval-case modal).
- **Non-goal:** Introducing any new LLM call. This feature adds product surface and deterministic
  aggregation over the *existing* review pipeline's output; it does not call a model itself.
- **Non-goal:** A bespoke "what this agent will likely flag on this specific PR" prediction. Per the
  design source, the Configure-run page's per-agent description is that agent's most recent run
  **summary** text, not a new PR-specific forecast (see Contracts).

## Implementation posture: keep v1 minimal
This is a first iteration meant to learn what users actually need before investing further — every
acceptance criterion below is written for the **cheapest implementation that satisfies it**, not the most
sophisticated one. Concretely: no historical-statistics computation where a single most-recent value will
do (AC-8), no new read endpoints where an existing one already returns the needed shape (Tabs-mode
findings, see Contracts), no speculative fields, caching layers, or precision tiers beyond what an
acceptance criterion literally requires. Where a fancier version is plausible later, it is captured under
*Proposals (out of scope)* instead of built now.

## User stories
- **US-1** As a reviewer on a PR page, I want to check a set of specialist agents and run them at once,
  so that I cover the PR from several angles in a single pass.
- **US-2** As a reviewer, I want a Configure-run page that shows each agent's estimated time and cost
  before I run, so that I can decide which agents are worth running on this PR.
- **US-3** As a reviewer, I want to watch each agent's status update live as the run progresses, so that
  I get feedback instead of staring at one spinner.
- **US-4** As a reviewer, I want findings from different agents at the same code location grouped
  together — including who did *not* flag it — so that I see agreement and disagreement instead of
  duplicate noise.
- **US-5** As a reviewer, I want to drill into one agent's full findings (description, confidence,
  suggested fix) and act on them (accept/dismiss/learn/turn into eval case/reply), so that I can process
  a specialist's output in depth.
- **US-6** As a reviewer, I want to open each agent's full run trace and live log — the same drawer I
  already use from the single-agent PR page (Configuration, Stats, Findings, Prompt assembly, Tool
  calls, Raw output, plus the live log) — from its column or tab on the Multi-Agent Review page, so that
  I can answer "why did this finding cost what it cost" and "what did the grounding gate reject and why"
  for any of the fanned-out agents.
- **US-7** As a cost-conscious user, I want the run summary to show total time and total cost broken down
  per agent, so that I can see that parallelism saved wall-clock time but not money.

## Inputs (provenance)
- Selected agent set (which agents to fan out) — user input via picker/Configure page. `[new: 0 LLM calls]`
- Per-agent review results (findings, score, verdict, summary, tokens, cost, duration) —
  `[reused: existing per-agent run output from the run-executor / reviewPullRequest → agent_runs + findings + run_traces]`
- Per-agent time·cost estimates (Configure page) — `[deterministic: computed from that agent's
  historical agent_runs (durationMs, costUsd); the accompanying one-line description reuses that agent's
  most recent run's summary field, not a new prediction]`
- Per-location cross-agent grouping ("Where agents disagree") — `[deterministic: computed from the
  persisted findings of the runs in this multi-agent run, keyed on file:line per the existing `Conflict`
  contract; not stored]`
- Live per-agent status transitions — `[reused: existing SSE run-event stream + replay buffer]`
- Trace detail (prompt blocks, token counts, rejected grounding-gate findings, per-call cost) —
  `[reused: existing RunTrace document + RunTraceDrawer, unchanged]`

No new LLM call is introduced anywhere in this feature.

## Acceptance criteria (EARS)

### Agent picker on the PR page (US-1)
- **AC-1:** WHEN the user opens the "Run Review" control in the PR header, the system **shall** render a
  "Pick agents to run" dropdown listing every enabled agent as a checkbox row with the agent's icon,
  name, and a per-agent time estimate — the same value computed for AC-8, no separate lighter-weight
  variant. _(observable: dropdown renders one checkbox row per enabled agent with an estimate label
  identical in source to the Configure page's)_
- **AC-2:** WHILE at least one agent is checked in the picker, the system **shall** enable a primary run
  action; WHEN exactly one agent is checked, the action label **shall** read "Run `<AgentName>`" and
  launch that agent's existing single-agent review path; WHEN two or more agents are checked, the action
  label **shall** read "Run multi-agent review (N)" and launch a multi-agent run over the checked set.
  _(observable: label and launched path both switch at the N=1 → N≥2 boundary, matching the existing
  `RunReviewDropdown` behavior in the design source)_
- **AC-3:** WHEN the user activates the run action with two or more agents checked, the system **shall**
  launch a multi-agent review over exactly the checked set and navigate the user to the results page for
  that run. _(observable: results page opens showing N columns matching the checked set)_
- **AC-4:** WHERE the picker offers a "Configure agents…" affordance, the system **shall** navigate to
  the Configure-run page for the current PR when it is activated. _(observable: Configure-run page opens
  with the current PR preselected)_
- **AC-5:** The system **shall** replace the internal behavior of the existing `RunReviewDropdown` PR-page
  trigger with this multi-select picker (same trigger button/slot, new checklist body), such that no
  "run one / run all" toggle remains — only per-agent checkboxes. _(observable: PR header's Run Review
  control opens the checklist described in AC-1, not the old binary toggle)_
- **AC-5a:** WHERE the picker's "Select all" / "Clear" control is activated, the system **shall** check or
  uncheck every enabled agent accordingly. _(observable: toggling flips all checkboxes and the control's
  own label between "Select all" and "Clear")_

### Configure-run page (US-2)
- **AC-6:** WHILE no pull request is selected on the Configure-run page, the system **shall** show an
  empty-state placeholder in the "Agents to run" step and keep the "Run multi-agent review" button
  disabled. _(observable: empty-state text shown; run button disabled)_
- **AC-7:** WHEN a pull request is selected on the Configure-run page, the system **shall** render one
  card per available agent showing the agent icon, name, that agent's most recent run summary as a
  one-line description, and a per-agent time·cost estimate. _(observable: agent cards populate with
  summary text and estimate labels after PR selection)_
- **AC-8:** The system **shall** compute each agent's time·cost estimate as that agent's single most
  recent completed `agent_runs` row's actual `duration_ms`/`cost_usd` (global across PRs, not scoped to
  this repo/PR size, no averaging/median) — a one-row lookup, not a statistics computation — and **shall**
  show an explicit no-estimate indicator (not a fabricated number) when the agent has zero historical
  runs. _(observable: an agent with ≥1 prior run shows that run's exact duration/cost as its estimate; an
  agent with 0 prior runs shows the no-estimate indicator; decision revised 2026-07-15 — deliberately
  simpler than an averaged/median figure, per the "keep v1 minimal" posture)_
- **AC-9:** WHILE one or more agents are checked on the Configure-run page, the system **shall** show a
  pre-run summary line whose time equals the **maximum** (not sum) of the checked agents' estimated
  durations and whose cost equals the **sum** of the checked agents' estimated costs, labeled "parallel
  fan-out". _(observable: summary line updates as checkboxes change; confirmed against `RunConfig`'s
  `estTime = max(duration_ms)`, `estCost = sum(cost)` in the design source)_
- **AC-10:** WHEN the user activates "Run multi-agent review (N)" on the Configure-run page, the system
  **shall** launch a multi-agent review over exactly the checked set and navigate to the results page for
  that run, regardless of N (including N=1) — this page's dedicated purpose is always a multi-agent
  launch, and it **shall** always create a parent record per AC-11, unlike the PR-page picker's N=1
  fallback in AC-2. _(observable: results page opens with N columns matching the checked set; decision
  confirmed 2026-07-15)_

### Multi-run grouping / persistence (US-1, US-7)
- **AC-11:** WHEN a multi-agent review is launched — either from the PR-page picker with two or more
  agents checked, or from the Configure-run page with any N ≥ 1 — the system **shall** create one parent
  multi-agent-run record scoped to the workspace and PR, and **shall** associate every per-agent run in
  the fan-out with that parent via a `multi_agent_run_id` foreign-key column on `agent_runs`. The parent
  record itself stores only its own identity/timestamps; aggregate totals (cost, time, columns) **shall**
  be recomputed on read from the associated `agent_runs`, not denormalized onto the parent row.
  _(observable: the parent record resolves to exactly the launched set of per-agent runs; a PR-page
  picker launch with exactly one agent checked does NOT create a parent record, per AC-2's single-agent
  fallback)_
- **AC-12:** The system **shall** preserve per-finding agent attribution such that every persisted
  finding is traceable to the agent that produced it. _(observable: each finding in the response carries
  or resolves to its originating agent id)_
- **AC-13:** WHEN the results page requests a multi-agent run, the system **shall** return one column per
  associated agent conforming to the `AgentColumn` shape (run id, agent identity, status, verdict, score,
  summary, duration, cost, findings). _(observable: response validates against `MultiAgentRun`)_
- **AC-14:** IF an individual agent run in the fan-out fails, THEN the system **shall** return that
  agent's column with status `failed` and **shall** still return every other agent's column with its own
  status, without failing the whole multi-agent run. _(observable: a failed agent shows a failed column
  while sibling columns render normally)_

### Cross-agent finding grouping — "Where agents disagree" (US-4)
- **AC-15:** The system **shall** group findings from different agents into a single location group keyed
  on exact `file:line` match only (matching the existing `Conflict{file, line}` contract), computed
  deterministically from the run's persisted findings and not persisted itself. Findings on
  adjacent-but-non-identical lines **shall** remain separate location groups — no range-intersection
  collapsing. _(observable: two agents flagging the identical file:line produce one group; two agents
  flagging adjacent-but-different lines produce two separate groups — confirmed against
  `ConflictsSection`'s `c.file + ":" + c.line` grouping in the design source; decision confirmed 2026-07-15)_
- **AC-16:** WHEN a location group is displayed, the system **shall** show, for every agent that reviewed
  that location, that agent's stance: its severity/verdict and note if it flagged, or an explicit
  "did not flag" label (with note text when available) if it reviewed but did not flag — driven by
  `ConflictTake.verdict === 'ignored'` per the existing contract. _(observable: a group lists one entry
  per selected agent, including "did not flag" rows, styled distinctly from flagged rows)_
- **AC-17:** WHERE the "Show only conflicts" toggle is enabled, the system **shall** filter the list to
  only those location groups where the agents disagree — at least one flagged and at least one reviewing
  agent did not, or agents assigned divergent severities. _(observable: toggling hides unanimous groups,
  shows only mixed-stance groups)_
- **AC-18:** The system **shall** render agent notes/verdict text in location groups as data (not as
  executable markup), because that text derives from untrusted PR content. _(observable: markup embedded
  in a finding note is shown inert, not executed — see Untrusted inputs)_

### Results page — Columns mode (US-3, US-7)
- **AC-19:** The system **shall** render the results page in Columns mode with one column per associated
  agent, each header showing the agent icon, name, time·cost, a 0–100 score circle color-coded by
  severity, and a running/complete/failed status indicator. _(observable: N columns render with score +
  status in each header)_
- **AC-20:** WHILE a multi-agent run is in progress, the system **shall** update each agent's column
  status live as that agent transitions running → complete (or → failed), using the existing run-event
  stream. _(observable: a column visibly changes from running to complete/failed during the run without a
  manual refresh)_
- **AC-21:** WHEN an agent column is displayed, the system **shall** list that agent's findings (severity
  icon, title, file:line) and a findings count, and **shall** provide a working "View trace" affordance
  that opens the existing `RunTraceDrawer` for that agent's run id — this is new required wiring: the
  design's "View trace" label has no click handler today. _(observable: activating "View trace" opens the
  drawer with the correct run id, showing its Trace tab — Configuration, Stats, Findings, Prompt assembly,
  Tool calls, Raw output — and its Live-log tab)_
- **AC-22:** The system **shall** show a run header with the PR number/title, "N selected agents ·
  parallel", "fan-out via worktrees" label, total time (max of columns' durations), and total cost (sum
  of columns' costs). _(observable: header renders all elements; confirmed against `MetaRow`'s
  `totalTime = max(duration_ms)`, `totalCost = sum(cost)` in the design source)_

### Results page — Tabs + detail mode (US-5)
- **AC-23:** WHEN the user switches the results page to Tabs mode, the system **shall** render one tab per
  agent showing the agent's score, and **shall** show the selected agent's summary card (score, one-line
  verdict, "View trace", time·cost). _(observable: tab bar with per-agent scores; selecting a tab shows
  that agent's summary)_
- **AC-24:** WHEN an agent tab is selected, the system **shall** render that agent's full finding cards —
  each with severity icon, title, category tag, file:line range, confidence %, description, and a
  suggested-fix block — with non-focused findings collapsed to title + file:line + confidence until
  expanded. _(observable: expanded finding shows description + suggested fix; siblings show the collapsed
  summary)_
- **AC-25:** WHEN a finding's action row is shown in detail mode, the system **shall** offer Accept,
  Dismiss, Learn, Turn into eval case, and Reply to author actions, routing Accept/Dismiss/Learn/Reply
  through the existing finding-action capability and "Turn into eval case" through the existing eval-case
  draft capability. _(observable: Accept/Dismiss/Learn/Reply invoke the existing finding-action path;
  "Turn into eval case" opens the existing eval-case draft flow)_
- **AC-26:** The system **shall** render the "Where agents disagree" block below the finding list in both
  Columns mode and Tabs mode, sourced from the same underlying grouping (AC-15–AC-17). _(observable: the
  same grouping block appears under both modes)_
- **AC-26a:** WHEN the results page's "View trace" is activated from Tabs mode's summary card, the system
  **shall** open the same `RunTraceDrawer` as in Columns mode for that agent's run id. _(observable: the
  drawer opens identically from either mode)_

### Trace-answerable properties (US-6)
- **AC-27:** WHEN the user opens an agent's trace from the results page (Columns or Tabs), the system
  **shall** open the existing `RunTraceDrawer` such that the run's prompt-block token counts, per-call
  cost, and the grounding-gate's rejected findings with rejection reasons are visible, without any
  modification to the drawer's existing tabs or sections. _(observable: the trace drawer shows the
  prompt-assembly/token/cost breakdown and rejected-findings-with-reasons for that run — served entirely
  by the existing, unmodified engine)_

### Cost/time parallelism property (US-7)
- **AC-28:** The system **shall** report a multi-agent run's `total_cost_usd` as the sum of its agent
  columns' costs and its `total_duration_ms` as the maximum of its agent columns' durations (parallel
  wall-clock), not the sum of durations. _(observable: for a run of N agents, total cost ≈ Σ column costs
  and total duration ≈ max column duration; comparing a 1-agent vs 3-agent run on the same PR from the two
  runs' totals shows cost scaling with agent count while wall-clock does not)_

## Edge cases
- Zero agents checked when the run control is activated → run disabled; no request sent. → **AC-2**
- Exactly one agent checked in the PR-page picker → falls back to the existing single-agent run path and
  label via the existing `RunRequest` endpoint, no `multi_agent_runs` parent record created. → **AC-2**
  (contrast: an N=1 launch from the dedicated Configure-run page always creates a parent record — **AC-10, AC-11**)
- A selected agent has zero historical runs (cold start) → show explicit no-estimate indicator, never a
  fabricated number. → **AC-8**
- One agent in the fan-out fails while others succeed → failed column shown, siblings unaffected. → **AC-14**
- An agent produces zero findings → its column shows a 0 findings count and a high score; it still
  participates as a "did not flag" voice in every location group. → **AC-16, AC-21**
- A location is flagged by exactly one agent and reviewed-but-not-flagged by all others → it is a conflict
  and appears under "Show only conflicts". → **AC-16, AC-17**
- Findings from different agents on nearby but non-identical lines → each stays its own location group;
  no collapsing across lines. → **AC-15**
- All agents agree unanimously on every location → "Show only conflicts" yields an empty, non-error state.
  → **AC-17**
- A finding note or agent verdict text contains markup/instructions from the PR diff → rendered inert.
  → **AC-18**
- The user opens the results page after the run already completed (no live stream) → columns render from
  persisted state with final statuses; live updates simply do not apply. → **AC-13, AC-19**
- A trend/estimate array of length 1 feeding any sparkline/estimate widget → guard against the documented
  length-1 NaN in `@devdigest/ui` sparklines. → accepted: handled at implementation per
  `client/INSIGHTS.md` (gate `trend.length >= 2`)
- Concurrent multi-agent runs on the same PR → each launch creates its own parent record; the results page
  addresses one parent record. → **AC-11**

## Non-functional
- **Live status latency:** a per-agent status transition (running → complete/failed) **shall** be
  reflected in the Columns UI within the existing SSE stream's delivery, with no manual refresh (reuses
  the existing replay-buffer + live stream; no new polling loop). → **AC-20**
- **Cost transparency:** a multi-agent run **shall** expose per-agent cost and duration plus run totals so
  the "parallelism saves time, not money" property is externally checkable from the response and the two
  runs' traces. → **AC-28**
- **Security / untrusted content:** all agent-authored text shown in the new surfaces (finding notes,
  verdict notes, descriptions, suggested-fix blocks, conflict notes) **shall** be rendered as data, not as
  executable markup — using the safe-render path (the raw `@devdigest/ui` Markdown primitive is unsafe for
  untrusted content per `client/INSIGHTS.md`). → **AC-18**
- **Accessibility:** per-agent running/complete/failed status **shall** be conveyed with a text/ARIA
  status affordance (e.g. `role="status"`), not color alone, consistent with the existing degraded-badge
  pattern. → **AC-19, AC-20**
- **Trace-drawer parity:** the "View trace" affordance on every agent surface **shall** open the identical
  `RunTraceDrawer` component used on the single-agent PR page — same tab set, same footer action — so a
  user who already knows that drawer needs no new mental model on this page. → **AC-21, AC-26a, AC-27**
- **Success signal:** on a demo PR, running 3 agents shows all three columns transitioning live to
  completion, the "Where agents disagree" block correctly grouping cross-agent findings with explicit "did
  not flag" entries, "View trace" opens the real drawer with live/completed trace data for each agent, and
  a 1-vs-3-agent cost comparison shows ~3× cost with near-flat wall-clock.

## Cross-module interactions
This feature spans **client** (PR-page picker, Configure-run page, results page, trace-drawer wiring) and
**server** (new multi-agent-run service + routes, deterministic estimation + conflict grouping). It
**reuses** `reviewer-core`'s existing single-agent output and grounding gate unchanged, and the existing
execution and trace engines. `ci/` and `agent-runner/` are treated as fixed external contracts (out of
scope to modify).

```mermaid
sequenceDiagram
    participant U as User (PR page / Configure)
    participant C as client
    participant S as server (multi-agent module)
    participant X as run-executor (REUSE, unchanged)
    participant DB as persistence
    participant SSE as SSE run-event stream (REUSE)
    participant TD as RunTraceDrawer (REUSE, unchanged)

    U->>C: check agent set, Run multi-agent review (N)
    C->>S: launch multi-agent run {pr, agent_ids[N]}
    S->>DB: create parent multi_agent_run + N per-agent runs, associate
    S->>X: fan out N per-agent runs (existing engine, per-agent worktree isolation)
    S-->>C: parent id + N run ids
    C->>SSE: subscribe per run id (live status)
    X-->>SSE: per-agent running -> complete/failed events
    SSE-->>C: live column status updates
    C->>S: fetch multi-agent run (columns + conflicts)
    S->>DB: read associated runs + findings
    S-->>C: MultiAgentRun {columns[], conflicts[], totals}
    C->>C: render Columns / Tabs + "Where agents disagree"
    U->>C: View trace (per agent column/tab)
    C->>TD: open with run id (new wiring; drawer itself unchanged)
    TD->>SSE: subscribe (if still running) / load persisted RunTrace
    TD-->>U: Trace tab (Configuration/Stats/Findings/Prompt assembly/Tool calls/Raw output) + Live-log tab
```

Failure contract: a single agent-run failure is isolated by the existing engine (per-agent worktree); the
server returns that agent's column as `failed` and the multi-agent run as a whole still succeeds
(**AC-14**). Estimation and conflict grouping are deterministic reads that must degrade to an empty/
no-estimate state rather than throw, consistent with the "best-effort enrichment" server convention.

## Contracts
The multi-agent response shapes **already exist** in `@devdigest/shared` (`contracts/observability.ts`)
and are reused as-is — this spec does not redefine them, only depends on their shapes:

- `MultiAgentRun` — `{ id, pr_id, pr_number?, ran_at, agent_count, total_duration_ms, total_cost_usd,
  columns: AgentColumn[], conflicts: Conflict[] }`.
- `AgentColumn` — `{ run_id, agent_id, agent_name, provider, model, status: 'done'|'failed'|'running',
  verdict, score, summary, duration_ms, cost_usd, findings: AgentColumnFinding[] }`.
- `AgentColumnFinding` — the column-list subset `{ id, severity, category, title, file, start_line,
  kind? }` (note: it deliberately omits `rationale`/`suggestion`/`confidence`/`end_line`; Tabs-mode detail
  **shall** be served by the existing per-PR findings read, filtered client- or server-side by
  `agent_run_id` — do not build a new detail-read endpoint for this; the full `Finding` shape already
  contains everything AC-24 needs).
- `Conflict` — `{ file, line, title, takes: ConflictTake[] }` — confirmed grouping key is exact
  `file:line`, matching the design source's `ConflictsSection`. `ConflictTake` —
  `{ agent_id, persona, verdict: Severity | 'ignored', note }`. The `'ignored'` verdict is the "did not
  flag" state (AC-16), confirmed against the design's `t.verdict !== "ignored"` flagged/not-flagged split.
- `Finding` (full) and `FindingActionKind` (`accept|dismiss|learn|reply`) — reused unchanged for
  detail-mode rendering and the action row.
- `AgentStats` — exists but is **not** consumed by this feature (future Per-Agent Stats).
- `RunTraceDrawer` props (`runId, agentName?, prNumber?, findings?, running?, onClose`) — reused unchanged;
  this feature's only job is to construct these props correctly per column/tab and mount the drawer.

New contract surface this feature needs but which is **not yet defined** and must be added (shape-level,
direction shown; decisions below confirmed 2026-07-15):
- **Launch request** (client → server): a dedicated `POST /pulls/:id/multi-agent-run { agent_ids: string[] }`
  endpoint — the existing `RunRequest` (`{ agentId?, all? }`) is left untouched and continues to serve the
  single-agent/"all agents" path (used by the PR-page picker's N=1 fallback, AC-2); the new endpoint is
  the only path that creates a `multi_agent_runs` parent record (AC-11).
- **multi_agent_runs table**: add `multi_agent_run_id` (nullable FK) to `agent_runs`; the parent table
  itself stays minimal (id, workspace_id, pr_id, ran_at, requested `agent_ids`) — no denormalized totals.
- **Per-agent estimate** (server → client, Configure page and picker — same value, one code path): shape-level
  `{ agent_id, est_duration_ms | null, est_cost_usd | null, last_run_summary?: string }`, sourced directly
  from that agent's single most recent completed run (`null` when zero runs exist — no averaging/median),
  plus an aggregate `{ est_wallclock_ms, est_total_cost_usd }` for the summary line — `est_wallclock_ms` =
  max across selected, `est_total_cost_usd` = sum across selected (confirmed by design source).

## Untrusted inputs
Yes. Every agent's findings, notes, verdicts, descriptions, and suggested-fix blocks are derived from
**untrusted PR content** (the diff, PR body, file contents) processed by the LLM. This feature adds new
places that render that text (columns, conflict cards, detail cards). All of it **must be treated as data,
never as instructions or executable markup**:
- Rendered via the safe-render path only — the raw `@devdigest/ui` `Markdown` primitive renders
  `<a href>` without filtering `javascript:`/`data:` URLs and is documented unsafe for untrusted content
  (`client/INSIGHTS.md`, 2026-07-07). Use the `SafeMarkdown` wrapper / inert rendering. → **AC-18**
- The grounding gate in `reviewer-core` remains the mandatory, non-bypassed gate on which findings exist
  at all; this feature consumes only findings that already survived it and never re-admits rejected
  findings. → **AC-27** (rejected findings remain visible only inside the trace, as today)
- No agent-authored text is fed back into any new prompt (this feature makes no LLM call), so there is no
  new prompt-injection surface beyond rendering.

## Assumptions
- Assumed the launch flow **reuses the existing parallel-execution engine** (run-executor + per-agent
  worktree isolation) and adds only a parent grouping record around it, per the stated REUSE boundary —
  say so if a separate execution path is intended.
- Assumed the parent multi-agent-run is **addressable for the results page** (create → return parent id →
  results page reads by parent id), rather than the results page re-deriving the set from a time window —
  say so if window-based grouping is preferred.
- Assumed per-finding agent attribution is satisfied by the existing `agent_runs.agent_id` → finding
  linkage (finding → its run → its agent), so no per-finding denormalized agent column is required — say
  so if an explicit denormalized attribution field is wanted.
- Assumed the PR-page picker's agent catalog (`window.AGENTS` in the design) and the Configure-run page's
  agent catalog (`window.PERSONAS` in the design) resolve to the **same underlying agent entity** in the
  real system (the mockup used two separate demo arrays for convenience) — say so if they are meant to be
  genuinely distinct sets.
- Assumed "Learn" is a wired-but-inert hook and "Turn into eval case" routes to the existing
  `POST /findings/:id/eval-case` + eval-case modal, with no new backend — say so if otherwise.

## Proposals (out of scope)
- [PROPOSAL: Persist a `batch_id`/parent link on `agent_runs` generally — the PR-list "latest review
  batch" today approximates a batch with a 120s `ranAt` window (`server/INSIGHTS.md`). The parent
  multi-agent-run record introduced here is exactly such a batch id; a follow-up could retire the window
  heuristic in `pulls/routes.ts` by reusing it.]
- [PROPOSAL: A "re-run only the failed agents" affordance on the results page, so a partial fan-out failure
  (AC-14) can be recovered without re-running the whole set.]
- [PROPOSAL: Deep-link a conflict-group entry to the owning agent's detail card (Tabs mode), reusing the
  existing finding deep-link pattern (`?tab=…&finding=…`) from the single-agent PR page.]
- [PROPOSAL: Once real usage shows the last-run estimate (AC-8) is too noisy (e.g. one slow outlier run
  skews the number shown to users), upgrade to a rolling average/median over N runs. Not built now —
  a single-value lookup is the cheaper thing to ship and observe first.]
- [PROPOSAL: If agents frequently land findings on adjacent-but-not-identical lines for the same issue
  (making "Where agents disagree" feel needlessly duplicated), add range-intersection collapsing to the
  file:line grouping. Deferred per the exact-match decision in AC-15 — revisit with real data, not a guess.]

## Decisions (confirmed 2026-07-15, resolving prior NEEDS CLARIFICATION)
- **Launch request:** dedicated `POST /pulls/:id/multi-agent-run { agent_ids: string[] }` endpoint;
  existing `RunRequest` is untouched. → Contracts, AC-3/AC-10/AC-11
- **Association mechanism:** `multi_agent_run_id` FK column on `agent_runs`; parent row stays minimal,
  totals recomputed on read. → Contracts, AC-11
- **Estimate formula (revised 2026-07-15 for simplicity):** the agent's single most recent completed
  run's actual duration/cost, global (not per-repo) — a one-row lookup, no median/average computation;
  zero prior runs → explicit no-estimate indicator. Originally scoped as a median of the last 5 runs;
  simplified per the explicit "keep v1 minimal" directive — a statistics computation isn't justified
  before we know whether users even look at the estimate. → AC-8, Contracts
- **N=1 on the Configure-run page:** always creates a `multi_agent_runs` parent record (unlike the
  PR-page picker's N=1 fallback, which uses the plain single-agent path with no parent record). → AC-10, AC-11
- **Near-miss line collapsing:** findings on adjacent-but-non-identical lines are kept as **separate**
  location groups — grouping is exact `file:line` match only, no range-intersection collapsing. Simpler
  and matches the design/contract literally; if agents commonly land one line apart on the same issue,
  revisit with real usage data rather than guessing a range now. → AC-15

## Open questions
None outstanding.
