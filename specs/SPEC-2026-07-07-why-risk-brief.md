# Spec: Why+Risk Brief (PR Brief card)   |   Spec ID: SPEC-2026-07-07-why-risk-brief   |   Status: approved
Supersedes: none

## Problem & why
A reviewer opening a PR has no short answer to "what does this PR do, why, how risky is it,
and what should I read first?". The facts already exist in the system but live in separate
places: intent (L03), blast radius (L04), smart-diff group statistics (L03), the linked issue,
and specs attached in the Context Folder. They are never consolidated into a single, glanceable
brief.

Today the top block of the PR Overview page is a `PrBriefCard` that renders four blocks
(Intent · Blast · Risks · History) from a **composed** `PrBrief {intent, blast, risks, history}`
shape and requests `GET /pulls/:id/brief` — but **no server module answers that route** (there
is no `brief` module in the static registry), so the card resolves to its error state. There is
no generated what/why summary, no risk-level banner, and no "read this first" navigation.

After this feature the PR page shows a generated **Brief**: a short what/why, a risk level as a
banner colour, concrete risks linking to real files, and a clickable review-focus "read these
first" list that navigates straight into the code. The guiding principle matches the rest of the
product — **deterministic modules gather the facts, exactly one structured LLM call writes the
narrative** — so cost stays at cents per PR and no diff bodies are ever sent to the model.

> Verified-state note: the current top block is **not** a hardcoded `PrBriefPlaceholder` — it is a
> live `PrBriefCard` wired to `usePrBrief` → `GET /pulls/:id/brief` against a **missing** server
> route, rendering the composed `PrBrief {intent, blast, risks, history}` type. This feature
> **reworks that existing card and hook in place** to the new Brief contract (see *Goals* and
> *Resolved during spec review*); it does not replace a placeholder.

## Goals / Non-goals
- Goal: A new route **POST /pulls/:id/brief** that assembles input from **already-derived facts
  only** (intent + blast summary + smart-diff per-group statistics + linked issue + relevant
  Context-Folder specs), makes **exactly one** structured LLM call, and returns
  `Brief {what, why, risk_level, risks[], review_focus[]}`.
- Goal: Cache the Brief per-PR with invalidation by `headSha`; a dedicated **regenerate** control
  forces recomputation.
- Goal: A structural **grounding gate** — every path in `risks[].file_refs` and
  `review_focus[].file_refs` is validated against the set of real paths known from Blast Radius
  and Smart Diff, before the response reaches the client (path-level check, no line precision).
- Goal: **Rework the existing `PrBriefCard` and its `usePrBrief` hook in place** to the new Brief
  contract — the top block coloured by `risk_level` with what/why text (shown alongside the latest
  Run Review metrics), Risk Areas as an accordion inside IntentCard, and Review Focus as a
  clickable list that navigates into the code. The card switches from `GET` to **POST**
  /pulls/:id/brief (force via body `{ force?: boolean }`).
- Goal: Surface the top-block Run Review metrics **including `tokens_in`→`tokens_out`**. These
  token counts are persisted at the **run** level (`agent_runs.tokens_in` / `tokens_out`) but are
  not currently exposed on the metric shape the PR page reads — so this feature's scope
  **expands to the `reviews` module** to surface `tokens_in`/`tokens_out` (alongside
  `findings_count`, `blockers`, `score`, `cost_usd`) for the latest completed Run Review, so the
  client can display them (AC-11).
- Goal: Replace dead/obsolete shapes rather than leaving legacy — delete the composed `PrBrief`
  type **and its client test**, remove the `Intent.risk_areas` field, and drop the
  `pr_intent.risk_areas` DB column. No legacy left behind.
- Non-goal: **WhyTimeline** (a stretch item) — a separate spec later, not here.
- Non-goal: Adding diff bodies / hunks to the LLM input.
- Non-goal: Changing the existing Blast Radius card, the Files-changed / Smart-order tab, or the
  Run Review logic — the Brief only reads their public data and navigates to them.
- Non-goal: Introducing new model configuration — `FeatureModelId "risk_brief"` is already
  registered.
- Non-goal: Moving the top-block metrics (findings/blockers/score/cost/tokens) into the Brief
  schema — they remain fields of the latest review record.
- Non-goal: Accessibility (A11y) work — explicitly out of scope for this feature.

## User stories
1. As a reviewer, I want to understand in seconds what a PR does and why, so that I can decide
   where to start reviewing.
2. As a reviewer, I want to see the risk level and concrete risks with links to real files, so
   that I do not miss dangerous changes.
3. As a reviewer, I want to click a file in the review-focus list and land directly in that file
   in the code.
4. As a reviewer, I want a dedicated regenerate button, so that I can refresh the Brief after
   significant changes even without a new commit.
5. As a reviewer, I want the Brief to appear instantly from cache when I reopen the PR, with no
   new LLM call.

## Inputs (provenance)
- Intent text (`summary`, `in_scope`, `out_of_scope`) — `[deterministic: intent]`
  (`pr_intent`, per-PR; **note:** intent is stored per PR, not keyed by `headSha` today — see
  *Open questions*). The `risk_areas` field is being removed by this feature.
- Blast summary + known-path set — `[deterministic: blast]` (`buildBlast(db, prId)`); the
  changed-symbol / downstream paths also seed the grounding path-set.
- Smart-diff per-group statistics (core / wiring / boilerplate, additions/deletions) + known-path
  set — `[deterministic: smart-diff]` (`buildSmartDiff(db, prId)`).
- Linked issue (number / title / body) — `[deterministic: pulls]` (`PrDetail.linked_issue`,
  optional).
- Relevant specs — `[deterministic: project-context]` (optional) — the `.md` docs attached to the
  repository's active review agent (Context Folder), trimmed to the residual token budget.
- **Brief** — `[new: 1 LLM call]`. Justification: one structured call turns the already-collected
  derived-fact set into `what / why / risk_level / risks[] / review_focus[]` in a single pass; it
  sends **no** diff bodies, so cost stays at cents. One call per section (or per risk) is
  forbidden (AC-1, AC-2).
- Top-block metrics (findings count, blockers, score, `cost_usd`, `tokens_in`→`tokens_out`) —
  `[reused: latest completed Run Review]` (**not** part of the Brief). There is no named
  `RunSummary` contract: `score`/`cost_usd`/`findings` derive from the latest `ReviewRecord` /
  `PrMeta`; `findings_count` and `blockers` are computed from `findings[]`; `tokens_in`/
  `tokens_out` live on `agent_runs` and must be **surfaced by the `reviews` module** onto the
  metric shape the PR page reads (in-scope expansion, AC-11).

## Acceptance criteria (EARS)
> AC-17 is kept out of numeric order (between AC-12 and AC-13) to preserve the source numbering.

- AC-1: WHEN a client sends POST /pulls/:id/brief and no cached Brief exists for the PR's current
  `headSha`, the system **shall** assemble input from intent + blast summary + smart-diff
  per-group statistics + the linked issue (if any) + relevant Context-Folder specs, make **exactly
  one** structured LLM call, and return `Brief {what, why, risk_level, risks[], review_focus[]}`.
  _(observable: `curl POST` → 200 with a Brief; LLM adapter invocation count = 1)_
- AC-2: The system **shall not** include diff bodies / hunks in the LLM payload — the input is
  derived facts only (intent text, blast summary, per-group diff statistics, issue metadata, spec
  text).
  _(observable: unit — payload inspection contains no hunk lines: no `@@`, no `+`/`−` body rows)_
- AC-3: IF the assembled input exceeds 8000 tokens, THEN the system **shall** truncate the
  lowest-priority sections (Context-Folder specs first) so the final payload ≤ 8000 tokens.
  _(observable: unit — inflated specs → measured payload ≤ 8000 tokens)_
- AC-4: WHEN the LLM returns a `risks[].file_refs` or `review_focus[].file_refs` entry naming a
  file absent from the known-path set (Blast Radius ∪ Smart Diff), the system **shall** drop that
  `file_ref` before responding (path-level check, no line precision).
  _(observable: unit — stubbed LLM with a hallucinated file → that ref is absent from the output)_
- AC-5: IF, after the grounding filter, a `review_focus` item has no valid `file_ref`, THEN the
  system **shall** drop that item; a `risks` item with empty `file_refs` **shall** be kept.
  _(observable: unit)_
- AC-6: WHILE the PR `headSha` is unchanged since the last generation, the system **shall** return
  the cached Brief with no new LLM call on a repeat POST without `force`.
  _(observable: `curl` twice → the second call charges 0 LLM calls)_
- AC-7: WHEN the PR `headSha` differs from the cached Brief's stored `headSha`, the system
  **shall** treat the cache as invalid and generate a new Brief.
  _(observable: unit/it — headSha change forces regeneration)_
- AC-8: WHEN a client sends POST with `force`, the system **shall** make a new LLM call and
  overwrite the cache even without a `headSha` change.
  _(observable: `curl force=true` twice → both calls are fresh LLM calls)_
- AC-9: IF the LLM call fails, THEN the system **shall** return a deterministic error (no stack
  trace in the body) and **shall not** write a corrupt Brief to the cache.
  _(observable: unit — 5xx `{ error }`; cache unchanged)_
- AC-10: WHEN a Brief is loaded, the client **shall** render the PrBriefCard top block with a
  banner colour by `risk_level` (high|medium|low) and the what/why text.
  _(observable: component test)_
- AC-11: WHERE a completed Run Review exists for the PR, the client **shall** render the latest
  review metrics beside the Brief text, comprising **all** of: `findings_count`, `blockers`,
  `score`, `cost_usd`, and `tokens_in`→`tokens_out`. WHERE `tokens_in`/`tokens_out` are not yet
  exposed on the metric shape the PR page reads, the `reviews` module **shall** surface them (from
  `agent_runs`) so the client can display them.
  _(observable: component test asserts all five metric fields render; a contract/it test asserts
  the metric shape carries `tokens_in`/`tokens_out` for a completed run)_
- AC-12: IF no Run Review has run yet, THEN the client **shall** render the Brief content and, in
  place of the metrics, a nudge ("Review not run yet") with a button that reuses the existing Run
  Review action.
  _(observable: component test)_
- AC-17: IF a Brief generation is already in progress for a PR, THEN the system **shall not**
  start a second parallel LLM call — the second request waits for the result (advisory lock by
  `prId`).
  _(observable: it — two concurrent POSTs → LLM invocation count = 1; both receive the same Brief)_
- AC-13: WHEN a Brief contains `risks[]`, the client **shall** render Risk Areas as an accordion
  inside IntentCard: an icon by `kind`, the `title`, and clickable `file_refs`; expanding an item
  reveals its `explanation`.
  _(observable: component test)_
- AC-14: WHEN a user clicks a `file_ref` in `review_focus` or `risks[].file_refs`, the client
  **shall** switch to the "Files changed" tab, scroll to, and highlight the file (and the line if
  one is specified).
  _(observable: E2E)_
- AC-15: The client **shall** render a dedicated Brief **regenerate** button, distinct from the
  Run Review button; clicking it **shall** send POST /pulls/:id/brief with `force=true`.
  _(observable: component test)_
- AC-16: After implementation, the system **shall not** return `risk_areas` in GET
  /pulls/:id/intent, and `Risk.kind` **shall** accept only the `RiskAreaKind` enum.
  _(observable: contract test)_

## Edge cases
- 0 risks → empty `risks[]`; the client hides the Risk Areas section → AC-13 (rendered empty)
- 0 review_focus → the client hides the Review Focus section → AC-5, AC-14 (nothing to render)
- All file_refs hallucinated → all `review_focus` items dropped, `risks` kept without links; the
  card stays informative (what/why/risk_level) → AC-4, AC-5, AC-10
- No linked issue → issue section omitted from input, not an error → AC-1
- No specs in the Context Folder → input assembled without specs → AC-1
- Blast Radius degraded → the known-path set narrows to smart-diff files; grounding does not fail
  → AC-4 _(accepted risk: under a degraded blast, some valid refs may be dropped)_
- Concurrent requests → advisory lock by `prId` → AC-17
- Loading state → an indicator consistent with the existing PrBriefCard / IntentCard loading
  pattern (skeleton; the regenerate button is disabled while in flight) → AC-10, AC-15
- Error state → a message consistent with the existing PrBriefCard error affordance, with retry
  via regenerate → AC-9, AC-15
- `file_ref` without a line → scroll to and highlight the file; line highlight is skipped → AC-14
- Input exceeds 8000 tokens → lowest-priority sections truncated (specs first) → AC-3

## Non-functional
- **Cost:** exactly one structured LLM call per fresh generation (AC-1); no diff bodies in the
  payload (AC-2); LLM payload ≤ 8000 tokens on a real run (AC-3); cache hit at unchanged `headSha`
  charges no LLM call (AC-6). Target: cents per generation.
- **Reliability:** an LLM failure returns a deterministic error and never corrupts the cache
  (AC-9); concurrent generations are serialized by a per-PR advisory lock so at most one LLM call
  is charged (AC-17).
- **Security / untrusted inputs:** see *Untrusted inputs* — PR body, issue body, spec text, and
  intent text are treated as **data, never instructions**, wrapped/marked as untrusted before the
  LLM call. The grounding gate (AC-4/AC-5) is the mandatory second barrier.
- **Grounding note:** reviewer-core `groundFindings()` is **not** applicable here — it grounds
  findings against diff **hunks** (`UnifiedDiff`), which by design are absent from the Brief
  input. A lighter path-set grounding gate is used instead (AC-4/AC-5).
- **Success signal:** a reviewer can, from the PR page, read what/why, gauge risk from the banner
  colour, open a concrete risk's file, and jump to the first file to read — from a single card,
  at cents-scale cost with exactly one LLM call.

## Cross-module interactions
A new **`brief`** server module (`server/src/modules/brief/`, registered in the static module
registry) owns POST /pulls/:id/brief. It reaches every other capability **only through public
service interfaces / the DI container** — never by importing another module's internals — and
sends no diff bodies to the model.

- `client` → **POST /pulls/:id/brief** → `brief` (server)
- `brief` → `intent` — cached intent text `[deterministic]`
- `brief` → `blast` (`buildBlast`) — blast summary + a source of the grounding path-set
  `[deterministic]`
- `brief` → `smart-diff` (`buildSmartDiff`) — per-group statistics + a source of the path-set
  `[deterministic]`
- `brief` → `pulls` (`PrDetail.linked_issue`) — `[deterministic: optional]`
- `brief` → `project-context` — the specs attached to the repo's active review agent
  `[deterministic: optional]`
- `brief` → LLM via `resolveFeatureModel(container, wsId, "risk_brief")` →
  `llm.completeStructured(Brief)` — `[new: 1 LLM call]`
- `brief` → `pr_brief` cache — read/write
- `client` → `reviews` — the reworked top block reads the latest completed Run Review's metrics
  (`findings_count`, `blockers`, `score`, `cost_usd`, `tokens_in`→`tokens_out`). The `reviews`
  module surfaces `tokens_in`/`tokens_out` (from `agent_runs`) onto that metric shape (AC-11,
  in-scope expansion).

**Binding entry points (verified — notes for the implementation-planner):** these supersede the
names in the source material.
- Blast: module functions `mapBlast(...)` / `buildBlast(db, prId)` (there is no `BlastService`
  class / `getForPr`).
- Smart Diff: its **own** `smart-diff` module (not under `pulls`), function
  `buildSmartDiff(db, prId)`.
- Context Folder: class `ProjectContextService` (`discoverDocuments` / `previewDocument` /
  `saveDocument`) — the planner may add a "read attached docs by path" affordance or reuse
  `discoverDocuments` + `previewDocument`; there is no `readDocsByPaths` today.
- Feature-model + LLM: `resolveFeatureModel(container, wsId, "risk_brief")` →
  `llm.completeStructured` (established pattern in `intent`/`conventions`).

Failure contract: any single fact source that fails or is unavailable (no issue, no specs,
degraded blast) is **omitted** from the input rather than failing the whole generation; only an
LLM-call failure surfaces as an error (AC-9), and it never corrupts the cache.

```mermaid
sequenceDiagram
    participant U as Reviewer (client)
    participant B as brief module (server)
    participant I as intent
    participant BL as blast
    participant SD as smart-diff
    participant P as pulls (PrDetail)
    participant C as project-context
    participant L as LLM (1 structured call)
    U->>B: POST /pulls/:id/brief { force? }
    B->>B: acquire advisory lock by prId (AC-17)
    alt cached Brief for current headSha and not force
        B-->>U: cached Brief (0 LLM calls) (AC-6)
    else generate
        B->>I: intent (summary/in_scope/out_of_scope)
        B->>BL: blast summary + paths
        B->>SD: per-group stats + paths
        B->>P: linked_issue (optional)
        B->>C: relevant specs (optional)
        B->>B: assemble derived facts, wrap untrusted text, cap ≤ 8000 tokens (AC-2/AC-3)
        B->>L: ONE structured call → Brief
        alt LLM ok
            B->>B: grounding gate strips unknown file_refs (AC-4/AC-5); cache Brief + headSha
            B-->>U: Brief { what, why, risk_level, risks[], review_focus[] }
        else LLM fails
            B-->>U: deterministic error; cache unchanged (AC-9)
        end
    end
```

## Contracts
Interface-level shapes only (field names illustrative; no implementation prescribed).

**POST /pulls/:id/brief** — replaces the client's current `GET /pulls/:id/brief` request; the
`usePrBrief` hook is reworked to POST (force via body).
- body: `{ force?: boolean }`
- `200` → `Brief`
- `5xx` → `{ error: string }` (no stack trace)

**`Brief`** (cached per PR):
- `what: string`
- `why: string`
- `risk_level: "low" | "medium" | "high"`
- `risks: Array<Risk>`
- `review_focus: Array<ReviewFocusItem>`

**`Risk`** (reuse of the existing type with one narrowing):
- `kind: RiskAreaKind` — narrowed from a free string to the enum
  `"security" | "dependency" | "performance" | "data" | "api_change" | "other"`
- `title: string`
- `explanation: string`
- `severity: "high" | "medium" | "low"`
- `file_refs: string[]` — paths, optionally suffixed `:line` / `:line-range`

**`ReviewFocusItem`** (new):
- `label: string`
- `file_refs: string[]`

**Cache (`pr_brief`)** — stores the `Brief` plus the `headSha` it was generated at; invalidation
= `cachedHeadSha !== pull_requests.head_sha`. The current `pr_brief` table is `{ prId (PK), json }`
with **no** `headSha` column, so an additive schema change adds a generation-`headSha` column,
compared against `pull_requests.head_sha` (the same staleness pattern `pulls/status.ts` uses for
`last_reviewed_sha`). Decided — not an assumption.

**GET /pulls/:id/intent** — CHANGE: the response no longer contains `risk_areas` (AC-16).

**Latest-review metric shape** (read by the reworked top block, AC-11) — extended so it carries
`tokens_in` and `tokens_out` (surfaced from `agent_runs`) in addition to the existing
`score` / `cost_usd` / `findings` (from which `findings_count` and `blockers` are derived). Exact
field placement (extend `PrMeta`/`ReviewRecord` vs. a small dedicated shape) is the planner's call.

**Removed shapes (replaced, not left as legacy):**
- The composed `PrBrief { intent, blast, risks, history }` type **and its client test**
  (`PrBriefCard.test.tsx` fixtures reworked to the new `Brief` shape).
- `Intent.risk_areas` (contract field) and its generation in the intent-deriver prompt/schema.
- The `pr_intent.risk_areas` DB column (additive DROP-COLUMN migration).

## Untrusted inputs
Yes. The feature reads third-party text it does not control: the **PR body**, the **linked-issue
body**, **Context-Folder spec text**, and the persisted **intent text** (itself LLM-derived and
re-injected). All of it is treated as **data, never instructions** — wrapped / delimited as
untrusted regions in the single prompt before the LLM call. The path-set grounding gate
(AC-4/AC-5) is the mandatory second barrier: any file the model names that is not in the
deterministically collected Blast ∪ Smart-Diff path set is discarded before the response is
returned. (Reviewer-core `groundFindings()` is not usable here — it requires diff hunks, which the
Brief input deliberately excludes.)

## Assumptions
- Assumed the 8000-token cap is a hard ceiling on the assembled LLM payload and truncation drops
  whole low-priority sections (specs first), never partial facts that would mislead the model —
  say so if partial trimming is preferred.
- Assumed "relevant specs" = the `.md` docs attached to the repository's **active** review agent
  via the Context Folder (not all repo specs) — say so if broader.

(The grounding path-set = Blast Radius ∪ Smart Diff is fixed by AC-4; cache `headSha`, loading/
error copy, advisory lock, and metric source are decided — see *Resolved during spec review*.)

## Resolved during spec review (binding decisions, not open questions)
- **Existing card rework (in place):** the current `PrBriefCard` + `usePrBrief` hook are reworked
  to the new `Brief` contract and to **POST /pulls/:id/brief** (force via body `{ force? }`); the
  old `GET` request is replaced. The composed `PrBrief {intent, blast, risks, history}` type and
  its client test are deleted — no legacy remains.
- **Top-block metrics (strict, AC-11):** the top block shows `findings_count`, `blockers`,
  `score`, `cost_usd`, **and** `tokens_in`→`tokens_out` from the latest completed Run Review. The
  token counts exist on `agent_runs`; scope **expands to the `reviews` module** to surface them on
  the metric shape the PR page reads.
- **Verified service entry points (binding):** `buildBlast(db, prId)`, `buildSmartDiff(db, prId)`
  (own `smart-diff` module, not `pulls`), and `ProjectContextService` (planner may add a
  read-by-path method or reuse `discoverDocuments`/`previewDocument`). These supersede the
  `BlastService.getForPr` / `pulls smart-diff` / `ContextService.readDocsByPaths` names in the
  source material.
- **Cache invalidation:** the `pr_brief` cache stores its own generation `headSha` (additive
  column) and invalidates when it differs from `pull_requests.head_sha` (mirrors the
  `pulls/status.ts` staleness pattern). Confirmed.
- **Concurrency:** a Postgres advisory lock keyed by `prId` serialises concurrent generations
  (AC-17) — new infrastructure, confirmed.
- **Loading / error copy:** introduced fresh, consistent with the existing PrBriefCard /
  IntentCard skeleton-on-load and error affordances (regenerate disabled while in flight; error
  message with regenerate retry). Confirmed.
- **Context-Folder spec selection strategy** → active-agent attached specs, trimmed to residual
  token budget (captured in *Inputs* / *Cross-module interactions*).
- **Top-banner label when no Run Review exists** → AC-12 nudge ("Review not run yet" + Run Review
  action).

## Process / handoff criteria (not EARS)
- `spec.md` and `plan.md` committed **before** the feature code (git-log order).
- LLM input ≤ 8K tokens on a real run.
- A cross-model review note exists.
- `plan-verifier` passes on the final state with no unmet requirements.
- An open PR + a 1–3 min demo video (card → click into code).

## Proposals (out of scope)
- [PROPOSAL: WhyTimeline — a per-line "why this changed" timeline surfaced from the Brief; a
  separate spec, deliberately excluded here.]
- [PROPOSAL: Extend the grounding path-set to also include the PR's raw changed-file list (from
  `PrDetail.files`) so valid refs survive a degraded blast — the current accepted risk drops some
  valid refs when blast is degraded.]

## Open questions
None — all verification contradictions were reviewed and resolved (see *Resolved during spec
review*). For the record, the seven items flagged during drafting were decided as follows: the
current top block is a live `PrBriefCard` (not a placeholder) reworked in place; the composed
`PrBrief` type + its client test are deleted; the binding service entry points are `buildBlast` /
`buildSmartDiff` / `ProjectContextService`; the AC-11 metric source is the latest completed Run
Review with the `reviews` module surfacing `tokens_in`/`tokens_out` from `agent_runs`; the cache
stores its own `headSha` compared against `pull_requests.head_sha`; loading/error copy is
introduced fresh consistent with existing skeleton/error patterns; and AC-17 uses a Postgres
advisory lock keyed by `prId`.
