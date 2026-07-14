# Spec: Eval Pipeline for reviewer agents   |   Spec ID: SPEC-2026-07-10-eval-pipeline   |   Status: approved
Supersedes: none

## Problem & why
The review agent has no regression net. When someone edits an agent's system prompt, model,
or attached skills, there is no way to tell whether the change made reviews *better* or quietly
*worse* — whether it now misses a bug it used to catch, or re-flags something a human already
dismissed as noise. Reviewers already produce exactly the labelled data this needs every time
they **accept** or **dismiss** a finding: an accepted finding is a "the agent should find this"
example; a dismissed finding is a "the agent should not comment on this" example. This feature
turns those decisions into stored eval cases and lets an agent be re-run against the whole set,
producing deterministic recall / precision / citation metrics so prompt changes become
measurable ("old prompt vs new prompt") instead of guessed at. It ships as Lesson 06.

**Extension (2026-07-11) — manual case authoring via a structured Case Editor.** The dataset above
only grows from findings the agent has already flagged. There is no path to log a case for a bug the
agent has *never seen* — someone else's incident, an edge case spotted in a colleague's review. The
`EvalCaseModal` already doubles as a manual-creation entry point (via the Evals tab's "New eval
case"), but its `expected_output` is edited as a **raw JSON textarea**: a reviewer capturing an
ad-hoc case must hand-write correct `{expectation, regions}` JSON, which defeats "capture it in the
moment". This extension replaces that textarea with a structured form (expectation select + repeatable
region rows), giving the dataset a second, human-seeded growth path. It is a client-side form rework
only — no schema, contract, route, or copy change (see Goals / Non-goals, AC-26–AC-35).

## Goals / Non-goals
- **Goal:** turn a real finding into an eval case via a **prefilled, reviewable** create flow — an
  *accepted* finding seeds `must_find`, a *dismissed* finding seeds `must_not_flag` — persisted only
  on explicit user confirmation, never a silent insert.
- **Goal:** run an agent against every case in its set with **frozen inputs**, so the only
  variable between two runs is the agent's own config (prompt/model/skills).
- **Goal:** score each run 100% deterministically (**zero LLM calls in the scorer**) into
  recall / precision / citation_accuracy using a fixed match rule.
- **Goal:** an "Evals" tab in the Agent editor (case list + run history) and a workspace-level
  **Eval Dashboard** sidebar page (recent evals across agents).
- **Goal:** compare two runs side by side — metric deltas + system-prompt diff — and promote a
  prompt version from that view.
- **Goal:** a `verify:l06` script that proves the deterministic scorer green with zero network.
- **Non-goal:** redesigning the `eval_cases` / `eval_runs` tables or the existing `eval-ci.ts` /
  `knowledge.ts` contracts. `eval_cases` is **frozen, untouched**. `eval_runs` gets exactly **two
  additive nullable columns** (`batch_id`, `agent_version` — see Contracts/Migration) for explicit
  batch identity; no existing column is changed or removed. This spec otherwise only *defines the
  JSON payloads carried inside the remaining opaque `jsonb` columns*, and may add net-new response
  shapes.
- **Non-goal:** eval cases for **skills** (`owner_kind='skill'`). The tables support it; this
  lesson delivers `owner_kind='agent'` only. Skill evals are a later lesson.
- **Non-goal:** the Conformance (`conformance_checks`) and Compose-Review (`composed_reviews`)
  features that happen to live in the same schema/contract files — out of scope entirely.
- **Non-goal:** the separate top-level `evals/` package (Claude-Code harness-evals CI) — unrelated.
- **Non-goal:** changing `reviewer-core`. The eval run path consumes its existing public exports
  (`reviewPullRequest`, grounding) only; no engine edit.
- **Non-goal:** injecting live repo-intel / callers / repo-map into an eval run (that would make
  runs non-comparable over time) — deliberately excluded, see AC-7.
- **Goal (extension):** author `expected_output` through a **structured Case Editor form** —
  expectation select + repeatable region rows with inline per-row validation — so a case can be
  logged for a bug the agent has never seen, without hand-writing JSON (AC-26–AC-35).
- **Non-goal (extension):** no `eval_cases` / `eval_runs` schema or migration change, and **no**
  change to the `EvalCaseInput` / `EvalExpectedOutput` / `EvalRegion` contracts — the structured form
  serialises to the existing frozen shapes.
- **Non-goal (extension):** no `owner_kind='skill'` support in the Case Editor (still agent-only).
- **Non-goal (extension):** no new page, route, or entry point — both existing entry points keep
  opening the same shared modal through the same `POST /eval-cases` (AC-35).
- **Non-goal (extension):** the `input_files` and `input_meta` tabs stay as raw-JSON textareas, and
  the diff paste + colorized preview stays unchanged — only `expected_output` is restructured.
- **Non-goal (extension):** no UI copy or title rebrand — existing "New eval case" / "Edit eval
  case" titles and button labels are unchanged; this is an internal form rework only.

## User stories
- US1: As a reviewer, I want to turn an **accepted** finding into a `must_find` eval case in one
  click, so the agent is later held to still finding it.
- US2: As a reviewer, I want to turn a **dismissed** finding into a `must_not_flag` eval case in
  one click, so the agent is penalised if it re-raises that noise.
- US3: As an agent author, I want to see all eval cases for an agent with pass/fail state, so I
  know what the agent is measured against.
- US4: As an agent author, I want to run the agent against every case and see recall / precision /
  citation_accuracy, so I can judge its current quality.
- US5: As an agent author, I want to open run history and compare two runs (metric deltas +
  prompt diff) and promote the better prompt version, so I can iterate safely.
- US6: As a user, I want an Eval Dashboard showing the most recent evals across all agents, so I
  can spot regressions at a glance.
- US7: As a course maintainer, I want `pnpm verify:l06` to prove the deterministic scorer, so the
  lesson has an objective green gate.
- US8: As a reviewer, I want to log an eval case for a bug the agent has never flagged — from a
  colleague's review or a past incident — by filling a structured form instead of hand-writing JSON,
  so I can seed the dataset with human judgment ahead of the agent encountering the pattern.
- US9: As a case author, I want each expected/forbidden region entered as a row with file + line
  fields and inline validation, so I cannot save a malformed or unscoreable case by accident.

## Inputs (provenance)
- Finding decision — `accepted_at` / `dismissed_at` timestamps on the `findings` row
  `[reused: reviews module persisted state]`.
- Finding region + enclosing diff fragment — `file` / `start_line` / `end_line` + the PR's stored
  diff for that file `[reused: findings + persisted PR diff]`.
- Eval case inputs — `input_diff` / `input_files` / `input_meta` / `expected_output`
  `[reused: eval_cases rows]`.
- Agent config used for a run — `system_prompt` / `model` / linked skills / `version`
  `[reused: agents + agent_versions]`.
- Grounding result — kept-vs-produced from `reviewer-core` grounding gate
  `[deterministic: reviewer-core, zero LLM]`.
- Recall / precision / citation metrics — pure comparison of actual vs expected regions
  `[deterministic: repo scorer, zero LLM]`.
- Case Editor form values — expectation + region rows typed by the author, or hydrated from a
  finding-derived draft / existing case row `[reused: eval_cases rows + finding-derived draft, zero
  LLM]`. The structured form serialises to the existing `EvalExpectedOutput` shape; no new input
  surface and no new LLM call are introduced by the extension.
- Agent findings per case — the agent's review of the frozen case input
  `[new: 1 LLM call per case per batch]`. **Justification:** observing the agent's behaviour under
  its current prompt *is* the feature; this is the same single review call the studio already
  makes, not an added call. Freezing the inputs (AC-7) is what makes those calls comparable
  across prompt versions. The **scorer** that turns their output into metrics adds **zero** calls.

## Acceptance criteria (EARS)
- AC-1: WHEN a user clicks "Turn into eval case" on an **accepted** finding, the system shall call
  `POST /findings/:id/eval-case`, which **builds and returns — without persisting — a draft**
  `EvalCaseInput` with expectation `must_find`: the finding's file diff fragment in `input_diff`,
  the finding region `{file,start_line,end_line,severity,category}` as the expected region in
  `expected_output`, `source_finding_id` in `input_meta`, and `name` defaulted from the finding title.
  _(observable: the call returns 200 with the draft payload; no new `eval_cases` row exists afterwards)_
- AC-2: WHEN a user clicks "Turn into eval case" on a **dismissed** finding, the system shall
  return an equivalent **unpersisted** draft with expectation `must_not_flag`, the same diff
  fragment, and the finding region as the **forbidden** region in `expected_output`.
  _(observable: the returned draft has expectation `must_not_flag` and its forbidden region equals the finding's file:line; no row is persisted)_
- AC-3: WHEN the draft is returned, the client shall open an editable `EvalCaseModal` prefilled
  with it (name, Diff/Files/PR-meta tabs, and a JSON editor over `expected_output`) so the user can
  review or amend the payload before anything is saved; WHERE a finding is neither accepted nor
  dismissed, the "Turn into eval case" button shall be disabled (no expectation can be derived).
  _(observable: the modal opens populated with the draft's file:line; a decision-less finding shows the control disabled)_
- AC-4: WHEN the user clicks **Save** in the modal, the client shall submit the (possibly edited)
  payload via the existing `POST /eval-cases`, which persists the row and returns the created
  `EvalCase`; clicking **Cancel** discards the draft with no persisted side effect. WHERE the "Run
  on save" toggle is enabled, Save shall additionally trigger a run for the newly created case
  (`POST /eval-cases/:id/run`) immediately after creation. The system shall derive the *prefilled*
  expectation from the finding's persisted decision only (`accepted_at` → `must_find`,
  `dismissed_at` → `must_not_flag`) — never from client input — but the modal's saved payload
  (after any user edits) is what is actually persisted and scored.
  _(observable: Save fires exactly one create request [+ one run request when the toggle is on]; Cancel fires no create request; a server test calling the draft endpoint on an accepted vs a dismissed finding yields must_find vs must_not_flag regardless of request body)_
- AC-5: WHEN the Evals tab is opened for an agent, the system shall list every eval case owned by
  that agent showing name, expectation type, region `file:line`, severity/category badge, and the
  case's most recent pass/fail.
  _(observable: the tab renders one row per case with a pass or fail icon reflecting the latest eval_run for that case)_
- AC-6: WHEN a user triggers "Run all evals" (`POST /agents/:id/eval-runs`), the system shall
  execute the agent against every case in its set, persist exactly one `eval_runs` row per case
  **sharing one newly-generated `batch_id`** (uuid column) and stamping each row's `agent_version`
  with the agent's current version, and return the aggregate `EvalRun` (recall / precision /
  citation_accuracy / traces_passed / traces_total / per_trace).
  _(observable: after a run over N cases, N eval_runs rows exist with an identical `batch_id` and the same `agent_version`, and the response aggregate's traces_total = N)_
- AC-7: The eval run shall build each review's input **solely** from the case's stored
  `input_diff` / `input_files` / `input_meta` plus the agent's current prompt / model / linked
  skills, with **no** repo-intel, callers, repo-map, or other live enrichment, so that two runs of
  the same set differ only by the agent's config.
  _(observable: a run executed twice with an unchanged agent produces byte-identical prompt assembly per case; no repo-intel facade call occurs)_
- AC-8: The scorer shall count an actual finding as **matching** an expected or forbidden region
  when the file path is equal AND the `[start_line,end_line]` ranges intersect (inclusive).
  _(observable: unit tests — same file + overlapping range → match; same file + disjoint range → no match; different file → no match)_
- AC-9: The system shall compute `recall` as the share of `must_find` expected regions across the
  set that were matched by at least one actual finding (`must_not_flag` cases contribute nothing
  to the recall denominator).
  _(observable: a set with 3 must_find regions of which 2 are matched yields recall = 2/3)_
- AC-10: The system shall compute `precision` as the share of the agent's actual findings across
  the set that are **not noise**, where a finding is noise if it matches a `must_not_flag`
  forbidden region OR (in a `must_find` case) matches no expected region; when the agent produced
  zero findings, precision shall be 1.
  _(observable: a run where the agent re-raises a must_not_flag region records that finding as noise and drops precision below 1)_
- AC-11: The system shall compute `citation_accuracy` as kept ÷ produced findings from the run's
  **grounding** result (findings that survived the grounding gate), not from any model self-report.
  _(observable: for an agent producing 4 findings of which 3 survive grounding, citation_accuracy = 0.75)_
- AC-12: The scoring step (mapping actual findings + expected/forbidden regions →
  recall / precision / citation_accuracy / pass) shall make **zero** LLM or provider calls.
  _(observable: `verify:l06` runs the scorer with an injected provider that throws on any call and still returns metrics)_
- AC-13: WHEN an agent's `system_prompt` is changed and its set is re-run, the resulting batch's
  recall and/or precision shall be able to differ from the prior batch (metrics are a pure function
  of the produced findings, hence of the prompt).
  _(observable: a fixture test running two distinct prompts — one that finds the seeded bug, one that does not — over the same case yields different recall)_
- AC-14: The system shall expose per-owner run **history** as batches — grouped by the `batch_id`
  column, each batch carrying its aggregate metrics, `ran_at`, and the `agent_version` it ran with
  — and, given two batch ids, shall present the metric deltas and a system-prompt diff between the
  two versions (resolved via `agent_version` → the `agent_versions` table).
  _(observable: the compare view for batch A vs B shows Δrecall/Δprecision/Δcitation and a line diff of the two versions' system_prompt)_
- AC-15: WHEN a user promotes a version from the compare view, the system shall set the agent's
  current configuration (at minimum `system_prompt`) to that version's snapshot.
  _(observable: after "Promote vN", GET /agents/:id returns the vN system_prompt)_
- AC-16: The workspace Eval Dashboard shall render each agent with its current
  recall / precision / citation_accuracy, the delta vs its previous batch, a trend sparkline, and a
  "recent eval runs · all agents" table.
  _(observable: the page maps one `EvalDashboard` row per agent plus a workspace `recent_runs` table)_
- AC-17: WHERE an owner has fewer than 8 eval cases **AND** no regression-flip alert (AC-25)
  applies, the dashboard shall surface a floor-warning `alert` indicating the set is below the
  recommended minimum; the L06 deliverable shall seed ≥ 8 cases for at least one agent.
  _(observable: an owner with 7 cases and no pass-flip shows the floor-warning alert; the seeded demo agent has ≥ 8 cases and no floor alert)_
- AC-25: WHEN comparing an owner's two most recent batches, IF any eval case's `pass` flips from
  `true` to `false` between them, THEN `EvalDashboard.alert` shall name that case in a templated
  regression message (distinguishing a `must_not_flag` case — "new false positive" — from a
  `must_find` case — "regression, no longer finds the expected issue"); this regression alert takes
  **priority** over the floor-warning (AC-17) whenever both would otherwise apply; WHERE more than
  one case flips, the alert shall name the first by case name ascending (deterministic tie-break).
  The reverse flip (`false` → `true`, an improvement) does not raise an alert.
  _(observable: flipping one seeded case's pass between batch A and batch B surfaces an alert naming that case, even when the owner has ≥8 cases; with no flip and <8 cases, the floor-warning from AC-17 shows instead; with no flip and ≥8 cases, alert is null)_
- AC-18: The Eval Dashboard shall be reachable from a left-sidebar item under "Skills Lab" at
  route `/eval`, active-highlighted while on `/eval` paths.
  _(observable: the sidebar shows the item; navigating to /eval marks it active via activeKeyFor)_
- AC-19: `server/package.json` shall define a `verify:l06` script scoped to the deterministic eval
  scorer test(s) only (mirroring `verify:l03`), green with zero network / LLM access.
  _(observable: `cd server && pnpm verify:l06` passes offline; it does not run the whole suite)_
- AC-20: IF a case's `input_diff` or PR body reaches the agent prompt during a run, THEN it shall
  pass through `reviewer-core`'s existing untrusted-input wrapping (`wrapUntrusted` /
  `assemblePrompt`), never interpreted as instructions.
  _(observable: the run path routes case text through the same assembly that wraps untrusted diff/PR body; no raw case text is concatenated into the system prompt)_
- AC-21: The system shall scope every eval-case and eval-run read or write to the caller's
  workspace, and WHEN creating a case from a finding shall verify the finding belongs to the
  caller's workspace, returning 404 otherwise.
  _(observable: a cross-workspace finding id yields 404; a cross-workspace case id is not listed or runnable)_
- AC-22: WHEN `expected_output` (or a hand-edited case payload) is submitted, the system shall
  `safeParse` it against the defined payload schema and reject an invalid payload with a 4xx,
  never persisting unvalidated JSON.
  _(observable: a malformed expected_output body returns 400 and no row is written)_
- AC-23: IF "Run all evals" is invoked on an owner with zero cases, THEN the system shall return an
  empty aggregate (traces_total = 0) without persisting a batch or erroring.
  _(observable: POST on an empty set returns 200 with traces_total 0 and creates no eval_runs rows)_
- AC-24: IF the agent's LLM call fails for one case during a batch, THEN the system shall record
  that case's `eval_runs` row as failed (`pass=null`, metrics null, error retained in
  `actual_output`) and continue the remaining cases, **retaining every case result already scored
  in the same batch**.
  _(observable: a batch where case 2 of 3 throws still persists rows for cases 1 and 3 with their metrics, plus a failed row for case 2)_

**Case Editor — structured `expected_output` form (extension 2026-07-11, approved).** The
following criteria (AC-26–AC-35) extend the case-creation flow (AC-1–AC-4): they replace the raw-JSON
`expected_output` editor inside the shared `EvalCaseModal` with a structured form so a reviewer can
log a case for a bug the agent has never seen without hand-writing JSON. The existing dual-source →
single-pipeline persist behaviour (AC-4, `POST /eval-cases`), the server-side `safeParse` gate
(AC-22), and the frozen `EvalCaseInput` / `EvalExpectedOutput` / `EvalRegion` contracts are
**unchanged** — only re-asserted here, never redefined. The diff paste + colorized preview
(`parseDiffLines` / `DiffPreview`) and the `input_files` / `input_meta` raw-JSON tabs are retained
**as-is** and are out of scope for this extension.

- AC-26: The Case Editor shall compose `expected_output` **exclusively** through a structured form —
  an expectation-type control plus a list of region rows — and shall present no raw-JSON textarea and
  no advanced-JSON escape hatch for `expected_output`.
  _(observable: the modal renders no free-text JSON editor for expected_output; the only way to author expected_output is the expectation control and region rows)_
- AC-27: The expectation control shall offer exactly the two values `must_find` and `must_not_flag`,
  and the selected value shall populate `expected_output.expectation` verbatim on Save.
  _(observable: selecting must_not_flag yields expected_output.expectation === 'must_not_flag' in the submitted payload; must_find yields 'must_find')_
- AC-28: Each region row shall expose `file` (text), `start_line` (number), `end_line` (number), an
  **optional** `severity` select (`CRITICAL` / `WARNING` / `SUGGESTION`), and an **optional**
  `category` select (`bug` / `security` / `perf` / `style` / `test`), and each row shall map
  one-to-one to an `EvalRegion` in `expected_output.regions`; a row whose severity/category is left
  unset shall omit those fields (they are optional on `EvalRegion`).
  _(observable: a form with two region rows produces expected_output.regions of length 2 with matching file/line values; a row with no severity selected serialises without a severity key)_
- AC-29: The Case Editor shall provide a first-class **"+ Add region"** action that appends a new
  empty region row and a per-row **remove** control that deletes exactly that row, replacing the
  former "Finding skeleton" JSON-append button (which shall no longer exist).
  _(observable: clicking "+ Add region" increases the row count by one; a row's remove control deletes only that row; no "Finding skeleton" control remains in the modal)_
- AC-30: WHEN the Case Editor is opened for a new (blank) eval case, the form shall initialise with
  exactly one empty region row (matching today's "Finding skeleton" default, now built into initial
  state rather than requiring a click).
  _(observable: opening "New eval case" renders exactly one region row before any user interaction)_
- AC-31: The system shall require at least one region row to save; IF every region row is removed,
  THEN Save shall be disabled.
  _(observable: removing the last remaining region row disables the Save button)_
- AC-32: The system shall validate each region row inline such that `file` is non-empty AND
  `start_line <= end_line`, marking any offending row as invalid; IF any region row is invalid, THEN
  Save shall be disabled.
  _(observable: a row with an empty file, or with start_line > end_line, is flagged invalid and disables Save; correcting it re-enables Save)_
- AC-33: The Save button shall be enabled only WHEN `name` is non-empty AND an expectation is
  selected AND every region row is valid — replacing the prior `EvalExpectedOutput.safeParse`-over-
  raw-JSON-text disable logic entirely.
  _(observable: Save is enabled exactly when name, expectation, and all region rows are valid; no code path gates Save on parsing an expected_output JSON string)_
- AC-34: WHEN the Case Editor is opened with an `initial.expected_output` that conforms to
  `EvalExpectedOutput` — whether a finding-derived draft carrying a single region (from
  `buildCaseDraftFromFinding`) or an existing case carrying one or more regions — the form shall
  preselect the stored expectation and render one prefilled region row per stored region.
  _(observable: opening the modal on an accepted finding shows one region row prefilled with the finding's file:line and the must_find expectation; opening a stored must_not_flag case with two forbidden regions shows two prefilled rows and the must_not_flag expectation — never an empty row and never raw JSON)_
- AC-35: Both existing entry points — the Evals tab "New eval case" action and `FindingCard`'s "Turn
  into eval case" (via `FindingsPanel`) — shall continue to open this same Case Editor component and
  persist the structured form (serialised to the frozen `EvalExpectedOutput` shape) through the
  existing `POST /eval-cases`; no new entry point, page, or route shall be introduced.
  _(observable: both entry points mount the one shared modal and fire the same single `POST /eval-cases` on Save; no new client route/page and no new server route are added)_

**Trend chart tooltip (Addendum 2026-07-13, approved).** The following criteria (AC-36–AC-40)
extend the "compare two runs" surface (AC-14/AC-16): they add prompt-version and cost context to
the existing metric trend chart on the agent detail dashboard (`/eval/[agentId]`), so a slow,
run-over-run drift in a metric is visible with *which prompt version and what it cost* attached to
each point — "look at the trend first, thresholds come later." `EvalTrendPoint` gains one
additive field (`agent_version`); no other contract, table, or migration change.

- AC-36: WHEN the agent detail dashboard (`/eval/[agentId]`) renders the metric trend chart, the
  system shall plot one point per eval batch (run), chronologically, for recall, precision, and
  citation_accuracy — as it already does today (no behaviour change, restated so this addendum is
  self-contained).
  _(observable: the chart's point count equals the owner's batch count returned by history(); points are in ran_at-ascending order)_
- AC-37: WHEN a user hovers a point on the trend chart, the system shall show a tooltip containing
  the run's timestamp, the agent/prompt version (`agent_version`), and the run's cost (`cost_usd`,
  formatted via the existing `formatCost` helper).
  _(observable: hovering a point renders a tooltip with that batch's ran_at, agent_version, and formatCost(cost_usd))_
- AC-38: IF `agent_version` is null for a run (e.g. a legacy row predating version tracking), THEN
  the tooltip shall render a "—" placeholder for version rather than omitting the tooltip or
  throwing.
  _(observable: a mocked trend point with agent_version: null still renders a tooltip, showing "—" for version)_
- AC-39: WHEN the trend series has fewer than 2 points, the system shall continue to suppress the
  chart (existing guard against a degenerate single-point series) rather than attaching a tooltip
  to an empty or broken chart.
  _(observable: a trend array of length 0 or 1 renders no chart, matching current behaviour)_
- AC-40: The system shall NOT add a chart to the Agent Editor's Evals tab (`EvalsTab.tsx`) — the
  compact-tab-with-link-out design stands; this addendum only enhances the existing full-dashboard
  chart.
  _(observable: EvalsTab.tsx renders no chart/recharts import; its "View full dashboard →" link is unchanged)_

## Edge cases
- Owner has zero cases and user runs the set → AC-23.
- Owner has < 8 cases and no case regressed between the last two batches → floor-warning alert, still runnable → AC-17.
- A case regresses (pass true→false) between the last two batches, even with ≥8 cases → regression alert names it, takes priority over any floor-warning → AC-25.
- Fewer than 2 batches exist for an owner → no regression comparison is possible → AC-25 contributes nothing; AC-17's floor-warning still applies if <8 cases.
- Agent LLM call fails on one case mid-batch → isolate + preserve prior results → AC-24.
- Finding is neither accepted nor dismissed → button disabled, no expectation → AC-3.
- Malformed / hand-edited `expected_output` JSON → 400, nothing persisted → AC-22.
- Cross-workspace finding or case id → 404 / not listed → AC-21.
- Oversized `input_diff` reaching the prompt → truncated by `reviewer-core`'s existing prompt
  budget in `assemblePrompt` → accepted: no new handling (relies on the engine's existing cap).
- Case's `input_diff` does not contain the finding's file/hunk (so grounding would drop the
  agent's finding) → the draft-building path (AC-1/AC-2) attempts to capture the finding's own file
  diff fragment; if the file isn't present in the stored PR diff, the draft's `input_diff` comes
  back **empty** rather than falling back to the whole raw diff — the modal (AC-3) surfaces this
  visibly empty so the user can paste/edit the fragment manually before Save, instead of silently
  persisting an unscoreable case.
- Two "run all" batches launched concurrently on one set → each gets its own independently
  generated `batch_id`; "current" = the batch with the newest `ran_at` → accepted: last-write-wins,
  no locking (the explicit `batch_id` column removes the timestamp-collision risk a `ran_at`-only
  proxy would have had).
- Same finding turned into a case twice → duplicate cases allowed (no dedupe) →
  accepted: no handling (a case is cheap; dedupe is a later refinement).
- `must_not_flag` case where the agent produced zero findings → pass, precision contribution 1 → AC-10.
- An `eval_runs` row with `batch_id IS NULL` or `agent_version IS NULL` (the columns are nullable at
  the DB level; every row this feature ever writes sets both, but the schema does not forbid a gap)
  → excluded from batch history/compare grouping (which groups by `batch_id`); still visible as that
  case's own most-recent single-case run for pass/fail (AC-5) → accepted: defensive filtering in the
  repository layer, no `NOT NULL` constraint (avoids a migration-time backfill requirement).
- **Case Editor** opened blank (new manual case) → form starts with exactly one empty region row;
  Save disabled until name + expectation + that row are valid → AC-30/AC-31/AC-32/AC-33.
- **Case Editor** region row with an empty `file`, or `start_line > end_line` → row flagged invalid,
  Save disabled → AC-32.
- **Case Editor** all region rows removed → Save disabled (a case with zero regions is unscoreable) →
  AC-31.
- **Case Editor** region row with `severity` / `category` left unset → saved region omits those
  optional fields (valid per `EvalRegion`) → AC-28.
- **Case Editor** hydrating a finding-derived draft (single region) or an existing multi-region case
  → each stored region renders as its own prefilled row, expectation preselected → AC-34.
- **Case Editor** a payload that is structurally valid client-side but still rejected by the server
  (e.g. a line value the server considers out of range) → the existing `POST /eval-cases` `safeParse`
  gate (AC-22) remains the final authority and returns 4xx, persisting nothing → accepted: no new
  client handling beyond surfacing the error; the structured form makes this path rare, not
  impossible.
- **Trend chart tooltip** a batch's `eval_runs.agent_version` is null (see the existing `batch_id
  IS NULL` / `agent_version IS NULL` edge case above — the columns are nullable at the DB level) →
  the tooltip still renders, with "—" in place of the version → AC-38.

## Non-functional
- **Security / access control (A01):** all eval endpoints are workspace-scoped via the existing
  base-repository guard; no cross-tenant read/write (AC-21). Case creation validates finding
  ownership.
- **Security / injection (A05, prompt):** case `input_diff` and any PR body are **untrusted data**;
  they only ever reach the model through `reviewer-core`'s `wrapUntrusted` / `assemblePrompt`
  hardening (AC-20). The `expected_output` JSON editor is validated with `safeParse` (AC-22),
  never `eval`'d or trusted.
- **Determinism:** the scorer is pure and offline — zero LLM calls (AC-12), enforced by
  `verify:l06` (AC-19).
- **Perf:** a "run all" over N cases fans out N single-pass reviews; the batch shall bound
  concurrency (reuse the existing queued-run mechanism) so a large set does not open N simultaneous
  provider connections. No hard latency budget — runs are user-initiated and progress-reported.
- **Success signal:** editing an agent's system prompt and re-running its set produces a batch
  whose recall/precision **visibly differ** from the previous batch in the compare view (AC-13) —
  i.e. prompt quality became a measurable number.

## Cross-module interactions
- **server** — new `eval` module (`modules/eval/`: routes + service + repository) registered with
  one line in `modules/index.ts`. It owns eval-case CRUD, the batch run endpoint, run history,
  compare, and the dashboard aggregate. The run path is a **DB-free-in-spirit** lightweight
  composition (mirroring `mcp-server/src/cli/review.ts`): it builds a synthetic `UnifiedDiff` from
  the case's stored `input_diff` and calls `reviewPullRequest` (+ its internal grounding) directly,
  rather than reusing `ReviewRunExecutor` (which assembles a real PR row and live repo-intel). The
  deterministic scorer is a pure module unit (no I/O) so it is testable with zero network.
- **reviewer-core** — unchanged; consumed via public exports (`reviewPullRequest`, and grounding
  results already returned by it). The mandatory grounding gate is **not** bypassed —
  citation_accuracy is derived from it (AC-11).
- **client** — three touch points: (1) "Turn into eval case" button on `FindingCard`, which fetches
  a draft via `POST /findings/:id/eval-case` and opens a shared, editable `EvalCaseModal` (also used
  for manual case creation and for re-opening/editing an existing case) — the actual persist happens
  only when the modal's Save is clicked, via the existing `POST /eval-cases`; (2) an
  "Evals" tab in the Agent editor (register in both the editor `TABS` and the page's `VALID_TABS`,
  or the tab silently redirects to config); (3) an "Eval Dashboard" page at `/eval` plus a sidebar
  item under Skills Lab (register in both `vendor/ui/nav.ts` and `activeKeyFor` — the latter already
  maps `/eval` → `"eval"`). New icon names must already exist in `vendor/ui/icons.tsx`
  (e.g. `Target` / `Gauge` / `BarChart` exist; `BarChart2` does not).

```mermaid
sequenceDiagram
    participant U as User
    participant W as client (Evals tab)
    participant S as server eval module
    participant RC as reviewer-core
    participant DB as Postgres
    U->>W: Run all evals
    W->>S: POST /agents/:id/eval-runs
    loop each case in set (frozen inputs)
        S->>RC: reviewPullRequest(prompt, model, synthetic diff)
        RC-->>S: grounded findings + grounding (kept/produced)
        S->>S: score (recall/precision/citation) — ZERO LLM
        S->>DB: insert eval_runs row (shared batch_id + agent_version)
    end
    S-->>W: aggregate EvalRun (traces_passed/total, metrics)
    W-->>U: metric cards + per-case pass/fail
```

## Contracts
Existing frozen prior art (do **not** modify beyond the additive migration below): `eval_cases`
table, unchanged, and `EvalCase` / `EvalRun` / `EvalPerTrace` / `EvalOwnerKind` (`knowledge.ts`);
`EvalCaseInput` / `EvalRunRecord` / `EvalRunResult` / `EvalTrendPoint` / `EvalDashboard`
(`eval-ci.ts`) — no existing field is removed or retyped. Any *new* contract below must be added
**lockstep** to both `server/src/vendor/shared/` and `client/src/vendor/shared/` (no auto-sync).

**Addendum 2026-07-13 — additive field on `EvalTrendPoint`.** `EvalTrendPoint` gains
`agent_version: number | null`, sourced the same way `EvalRunBatch.agent_version` already is (the
batch's stamped `eval_runs.agent_version`) — no migration, no other field change (AC-36–AC-40).

**Migration (decided 2026-07-10 — explicit columns over a `ran_at`-proxy):** add two **nullable**
columns to `eval_runs` — `batch_id uuid` and `agent_version integer` — plus an index on `batch_id`.
`eval_cases` is untouched. Generated via `pnpm db:generate` (a pure addition, not a rename — no
interactive TTY prompt per the server rename-gate rule) then `pnpm db:migrate`. **Existing-data
note:** verified directly against the codebase that nothing currently writes to `eval_cases` /
`eval_runs` — no seed script, no route, no service exists yet for either table (`server/src/db/
seed.ts` only mentions "eval" in a doc-comment listing tables future lessons will populate) — so
there is **no legacy data to migrate or backfill** in this repo today. The columns are still made
nullable rather than `NOT NULL`, defensively, for the general case (e.g. a manually-inserted test
row in some local DB): this feature's own write path always sets both fields; any row that somehow
lacks them is excluded from batch-grouped views rather than breaking the migration or requiring a
backfill (see Edge cases). `EvalRunRecord` (`eval-ci.ts`) gains matching top-level fields:
`batch_id: z.string().nullable()`, `agent_version: z.number().int().nullable()`.

**Spec-defined JSON payloads (carried inside the remaining opaque `jsonb` / `z.unknown()` columns —
no table or contract change beyond the migration above):**
- `expected_output` (shape only): `{ expectation: 'must_find' | 'must_not_flag', regions:
  [{ file: string, start_line: int, end_line: int, severity?: Severity, category?: FindingCategory }] }`.
  For `must_find` the regions are what must be found; for `must_not_flag` they are what must not be
  flagged. The `expectation` discriminator is stored **explicitly** (see Assumptions — empty-vs-
  non-empty is not a safe discriminator because `must_not_flag` carries a non-empty forbidden region).
- `input_meta` (shape only): `{ source_finding_id: string, pr_number?: int, ... }` — traceability
  back to the finding the case was born from.
- `actual_output` (shape only): `{ findings: [Finding-lite], grounding: { kept: int, produced: int },
  error?: string }` — **no longer carries `agent_version`** now that it is a real `eval_runs` column
  (avoids storing the same fact twice and risking drift between the column and the jsonb copy).

**API surface (behaviour + shape; exact routing is implementation):**
- Draft case from finding (`POST /findings/:id/eval-case`) — identifies the source finding; server
  derives `owner_id`, `expectation`, `input_diff`, `expected_output`, `input_meta` and returns an
  **unpersisted** `EvalCaseInput` (AC-1/2/3). The actual persist reuses the existing
  `POST /eval-cases` (same endpoint a manually-created case uses), submitting the modal's
  (possibly-edited) payload (AC-4).
- List cases for an owner → `EvalCase[]` (AC-5).
- `POST /agents/:id/eval-runs` → aggregate `EvalRun` (AC-6); persists per-case `EvalRunRecord` rows.
- Run history for an owner and Compare-two-batches → **net-new additive contracts (decided, see
  Open questions)**: a per-batch aggregate `EvalRunBatch { ran_at, agent_version, recall, precision,
  citation_accuracy, traces_passed, traces_total }` and an
  `EvalCompare { a: EvalRunBatch, b: EvalRunBatch, prompt_diff: {...}, delta: {...} }`, added
  lockstep to both vendor mirrors.
- Dashboard → existing `EvalDashboard` (workspace-level when `owner_id` is null) (AC-16/17).
- Promote version → reuse the agents update path to set the agent config from a version snapshot
  (AC-15).

**`verify:l06` script (explicitly in scope, per request):** add to `server/package.json`, mirroring
the single-file scope of `verify:l03`:
`"verify:l06": "vitest run src/modules/eval/scoring.test.ts"`. Binding requirement: the script is
**scoped to the deterministic eval scorer test(s)** (not the whole suite) and passes with zero
network / no API key. The exact test filename follows the module convention
(`src/modules/eval/…test.ts`); the implementer may adjust the filename but must keep the scope and
the offline-green guarantee.

## Untrusted inputs
Yes — a case's `input_diff` (a fragment of a real third-party PR diff) and any stored PR body are
untrusted text. During a run they reach the model **only** through `reviewer-core`'s existing
`wrapUntrusted` / `assemblePrompt` hardening, exactly as a normal review does — never concatenated
into the system prompt or interpreted as instructions (AC-20). The `expected_output` JSON authored
in the case modal is validated with `safeParse` against the defined payload schema (AC-22), not
trusted or executed.

## Assumptions
- Assumed **no schema or existing-contract change** is needed: the `expected_output` /
  `input_meta` / `actual_output` columns are `jsonb` (Zod `z.unknown()`), so their internal shapes
  are defined by this feature, not frozen. Say so if the tables/contracts should instead grow typed
  columns/fields.
- Assumed the `expectation` discriminator is stored **explicitly** inside `expected_output` rather
  than inferred from an empty-vs-non-empty regions array, because a `must_not_flag` case must carry
  its (non-empty) forbidden region for scoring — say so if inference is preferred.
- **Decided (2026-07-10): explicit `batch_id` column.** A batch is identified by the new
  `eval_runs.batch_id` (uuid) column, not a shared `ran_at` proxy — rejected the `ran_at`-window
  grouping trick used elsewhere in the codebase (`server/INSIGHTS.md` already flags that proxy as a
  known limitation for PR-list "latest review batch") to avoid repeating the same technical debt here.
- **Decided (2026-07-10): explicit `agent_version` column.** Each run's agent version is captured in
  the new `eval_runs.agent_version` column (not inside `actual_output` jsonb), so the compare
  prompt-diff resolves the two versions via a plain column read + join to `agent_versions`, with no
  JSON parsing and no risk of the jsonb copy drifting from the column.
- **Decided (2026-07-10): aggregation is pooled** (sum of numerators ÷ sum of denominators across
  cases) for recall/precision/citation, not a mean-of-per-case-ratios (macro-average was
  considered and rejected — pooled better reflects total noise/miss volume across the set).
- Assumed an eval run uses the agent's **currently linked enabled skills** plus prompt+model, with
  repo-intel off (AC-7). Say so if skills should also be frozen to the case's creation-time set.
- Assumed the sidebar "Eval Dashboard" icon is an existing icon (`Target` / `Gauge` / `BarChart`);
  the implementer picks one that exists in `vendor/ui/icons.tsx`.

## Proposals (out of scope)
- [PROPOSAL: dedupe cases created from the same `source_finding_id` (warn "already an eval case")
  to keep sets clean once creation is one-click and cheap to spam.]
- [PROPOSAL: a "diff drift" indicator on a case whose `input_diff` no longer matches the current PR
  head, so stale cases are visible.]
- [PROPOSAL: extend the same pipeline to `owner_kind='skill'` once agent evals land — the tables
  already support it.]

## Open questions
All three prior open questions are resolved (orchestrator + user decision, 2026-07-10):
- **Promote vN — RESOLVED, no new endpoint.** `GET /agents/:id/versions/:version` (existing) already
  returns a full config snapshot and `PUT /agents/:id` (existing) already updates the agent's current
  config. "Promote vN" is a client-side compose: GET the version snapshot, then PUT its `system_prompt`
  (and other fields) as the agent's current config. AC-15 requires no agents-module server changes.
- **Compare contracts — RESOLVED: add new contracts.** Net-new `EvalRunBatch` and `EvalCompare`
  response shapes are added, lockstep, to both `server/src/vendor/shared/` and
  `client/src/vendor/shared/`. The server computes deltas and the `system_prompt` diff; the compare
  view consumes `EvalCompare` directly (see Contracts section).
- **Precision noise rule — RESOLVED: extra = noise.** AC-10 stands as specified: any actual finding
  matching no expected region is noise (lowers precision), even in a `must_find`-only set, not only
  findings that hit a `must_not_flag` region.
</content>
</invoke>
