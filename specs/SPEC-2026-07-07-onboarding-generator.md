# Spec: Onboarding Generator   |   Spec ID: SPEC-2026-07-07-onboarding-generator   |   Status: approved
Supersedes: none

## Problem & why
A newcomer dropped into an unfamiliar repository has no single place that answers "what is this,
where does a request go, how do I run it, what do I read first, and what can I safely touch on day
one?". They reconstruct this by hand over days. DevDigest already indexes repositories (import
graph, file rank, structure) at zero marginal LLM cost — those facts can be turned into a guided
tour cheaply. The guiding principle: **code gathers the facts, the model writes the narrative** —
deterministic analyzers collect structural facts, and exactly **one** structured LLM call renders
them as prose. This keeps cost at cents per generation and is the deliberate contrast (measured at
the end of the course) to the naive "stuff the whole repo into context" approach.

## Goals / Non-goals
- Goal: Generate an **Onboarding Tour** with exactly five sections — (1) Architecture overview,
  (2) Critical paths, (3) How to run locally, (4) Guided reading path, (5) First tasks.
- Goal: Collect all structural facts deterministically (repo-intel + cloned-repo files) and produce
  the narrative in **one** structured LLM call.
- Goal: Compute the reading path by file rank `rank = pagerank × (1 + hotness)` over the import graph.
- Goal: Never show an empty screen — degrade to a deterministic skeleton with an honest badge.
- Goal: Make generation cost observable and keep it at cents per generation.
- Non-goal: Changing the five-section set, or making sections user-configurable.
- Non-goal: Real shareable/public token links (Share copies the internal URL only — see Assumptions).
- Non-goal: Automatically triggering a full re-index from the onboarding flow.
- Non-goal: Retrofitting strict feature-model resolution across other existing features (see Proposals).
- Non-goal: Executing, editing, or scaffolding any suggested "First task" file — First tasks are advisory.

## User stories
- As a newcomer developer, I want an auto-generated tour of an unfamiliar repo, so that I understand
  its architecture, critical files, and how to run it without asking a teammate.
- As a newcomer, I want a ranked reading order with a one-line reason per file, so that I read the
  highest-leverage files first instead of browsing alphabetically.
- As a newcomer, I want 2–3 concrete first tasks grounded in real gaps, so that I can make a safe
  first contribution.
- As a team lead, I want the tour to be cheap (cents) and its cost visible, so that onboarding scales
  across many repos.
- As any user, I want an honest, non-empty result even when the repo is only partially indexed or the
  model is unavailable, so that I am never blocked by a blank page.

## Inputs (provenance)
- Import-graph file rank / critical paths / index state — `[deterministic: repo-intel]`
  (`getFileRank`, `getTopFilesByRank`, `getCriticalPaths`, `getIndexState`).
- Repo structure, stack, routes — `[deterministic: repo-intel]`.
- `package.json` scripts, lockfile → package manager, `docker-compose` services, `.env.example`
  variable **names** — `[deterministic: repo-intel]` (read from the locally cloned repo).
- Hotness = commit frequency per file over a fixed recent window — `[deterministic: repo-intel]`
  (local `git log` on the clone; degrades to `0` when history is unavailable).
- Detected gaps for First tasks (missing test / doc / convention pattern) — `[deterministic: repo-intel]`.
- Five-section narrative — `[new: 1 LLM call]`. Justification: one structured call converts the
  already-collected fact set into readable prose for all five sections at once; it sends **no**
  full-file contents, so cost stays at cents and directly replaces the "whole repo into context"
  baseline. One call per section is explicitly forbidden (AC-2).

## Acceptance criteria (EARS)
- AC-1: WHEN a user requests onboarding generation for an indexed repo, the system **shall** return
  an Onboarding artifact populated with all five sections.
  _(observable: generation request returns success with 5 non-empty sections)_
- AC-2: WHEN rendering the narrative, the system **shall** make exactly ONE structured LLM call for
  all five sections, never one call per section.
  _(observable: LLM adapter invocation count = 1 per fresh generation)_
- AC-3: The system **shall** assemble every structural fact deterministically before the LLM call,
  incurring zero LLM cost during fact collection.
  _(observable: fact-collection stage records no LLM invocation)_
- AC-4: The system **shall** order the Guided reading path by `rank = pagerank × (1 + hotness)` over
  the import graph, not alphabetically or by modification date.
  _(observable: with hotness varied on top-N candidates, reading order differs from pure-pagerank order)_
- AC-5: WHERE local git history is available, the system **shall** compute hotness from commit
  frequency over the configured recent window; IF git history is unavailable THEN the system
  **shall** set hotness = 0 and still return a rank-ordered reading path.
  _(observable: a repo with no git history still returns an ordered reading path)_
- AC-6: IF the LLM references a file, package, or external service absent from the known-fact set,
  THEN the system **shall** discard that reference before returning the artifact.
  _(observable: a stubbed hallucinated reference is stripped from the output)_
- AC-7: The system **shall** wrap all third-party repo text (README/CLAUDE.md prose, config,
  `.env.example` names, file extracts) as untrusted data in the prompt, never as instructions.
  _(observable: prompt payload delimits these regions as untrusted)_
- AC-8: IF the repo index is degraded or absent, THEN the system **shall** return a deterministic
  skeleton built only from available facts, marked with an honest "degraded" badge, and **shall**
  never return an empty result.
  _(observable: a degraded/un-indexed repo returns a skeleton with the degraded flag set)_
- AC-9: IF the structured LLM call fails, THEN the system **shall** return the deterministic skeleton
  with a "narrative unavailable" flag and reason, leaving any previously cached artifact uncorrupted.
  _(observable: forced LLM error returns skeleton + flag; prior cache unchanged)_
- AC-10: The system **shall** generate the How-to-run-locally commands deterministically from the
  lockfile-derived package manager, `package.json` scripts, `docker-compose` services, and
  `.env.example` variable names, functioning fully in degraded and LLM-failure modes.
  _(observable: How-to-run is populated with the LLM stubbed off)_
- AC-11: IF architecture-diagram candidates exceed the node cap (5–8), THEN the system **shall**
  deterministically collapse the surplus into a single overflow node.
  _(observable: 12 candidate nodes → ≤ 8 nodes + 1 overflow node)_
- AC-12: The system **shall** populate Critical paths with 5–8 **file** entries, each carrying a
  one-line rationale and an open-file link, and **shall** reject non-file (e.g. service) entries.
  _(observable: output contains only file-kind entries, each with rationale + link)_
- AC-13: The system **shall** derive 2–3 First tasks from genuinely detected gaps, each with a
  suggested path, one-line rationale, pattern pointer, and complexity badge; IF no gap is detected
  THEN the section **shall** be omitted with an honest message rather than fabricated.
  _(observable: a zero-gap repo omits First tasks with an honest note; no invented task)_
- AC-14: WHEN onboarding is requested and a cached artifact exists for the repo's current head SHA,
  the system **shall** return the cached artifact with no new LLM call; WHEN the head SHA differs,
  the system **shall** regenerate.
  _(observable: 2nd request at same SHA → LLM count 0; request after SHA change → new LLM call)_
- AC-15: WHEN the user triggers Regenerate, the system **shall** force a fresh generation regardless
  of cache state.
  _(observable: a forced request always yields LLM count 1)_
- AC-16: IF two generation requests for the same repo arrive concurrently, THEN the system **shall**
  serialize them via a per-repo lock so at most one LLM call is charged and both callers receive the
  same result.
  _(observable: two parallel requests → LLM count 1, identical response)_
- AC-17: IF onboarding generation requests for a repo exceed the rate limit (10 per minute), THEN the
  system **shall** reject the excess with a 429.
  _(observable: the 11th request within a minute returns 429)_
- AC-18: IF the onboarding feature has no model selected in Settings, THEN the system **shall** reject
  generation with a 422 instructing the user to select a model, never a silent default.
  _(observable: missing model override → 422 with actionable message)_
- AC-19: WHEN the structured LLM call completes, the system **shall** log the generation cost as
  structured data including a `costUsd` field.
  _(observable: a structured log line carries costUsd after each fresh generation)_
- AC-20: The client **shall** render the five sections as collapsible cards with a sticky
  "on this page" scroll-spy nav and a header showing repo name, files-indexed count, and
  last-refreshed time, plus Regenerate and Share controls.
  _(observable: component test asserts the five cards, the nav, the header fields, and the controls)_
- AC-21: WHEN a user activates Open on a Critical-paths or Reading-path entry, the client **shall**
  open that file at its source location in a new browser tab.
  _(observable: entry renders an external blob link with target=_blank)_
- AC-22: WHEN a user activates copy on a How-to-run command, the client **shall** place that command
  text on the clipboard; WHEN a user activates Share link, the client **shall** copy the internal
  onboarding URL to the clipboard.
  _(observable: clipboard contains the command text / the internal URL respectively)_
- AC-23: The client **shall** render each First task with its suggested path, rationale, pattern
  pointer, and complexity badge, and **shall not** render it as a navigation link (the suggested file
  does not exist yet).
  _(observable: First-task card exposes no href or navigation handler)_

## Edge cases
- Repo not indexed / not cloned locally (no import graph) → degraded skeleton + badge + Regenerate affordance → AC-8, AC-20
- Index degraded/partial → skeleton from available facts, honest badge → AC-8
- Structured LLM call fails/times out → skeleton + "narrative unavailable" flag, cache uncorrupted → AC-9
- Non-JS/TS repo (no import graph) → graph-dependent sections degrade to directory/entrypoint heuristics; How-to-run works fully → AC-8, AC-10
- Empty `.env.example` / no docker-compose / no orchestration script → How-to-run proceeds from whatever exists (package.json scripts at minimum) → AC-10
- No git history for hotness → hotness = 0, reading path still rank-ordered → AC-5
- Diagram candidates > node cap → deterministic overflow node → AC-11
- LLM returns only hallucinated references → grounding gate strips them; fact-based sections remain → AC-6
- Zero detectable gaps → First tasks omitted honestly, not fabricated → AC-13
- Onboarding model not selected in Settings → 422, no silent default → AC-18
- Concurrent requests (two tabs, shared link, rapid Regenerate) → per-repo lock, single LLM charge → AC-16
- Request flood on one repo → 429 rate limit → AC-17
- Oversized repo → bounded fact set + single LLM call, no full-file contents sent → AC-2, AC-3, AC-11
- GitHub/DB read failure during fact collection → degrade the affected fact to empty/zero, never fail the whole generation → AC-5, AC-8

## Non-functional
- **Cost:** exactly one structured LLM call per fresh generation, sending no full-file contents;
  target cost is cents per generation (single-call, bounded-fact constraint enforced by AC-2/AC-3).
- **Security / untrusted input:** all repo-authored text is prompt-wrapped as data (AC-7); a grounding
  gate is a mandatory second barrier that discards references outside the known-fact set (AC-6). AI
  narrative is labelled as generated and is never executed.
- **Rate limiting:** ≤ 10 generation requests per minute per repo (AC-17); concurrency serialized
  per repo (AC-16).
- **Performance:** a cached GET returns in p95 < 300 ms; the deterministic skeleton (degraded/LLM-fail
  path) renders without any model round-trip.
- **Accessibility:** the tour meets WCAG 2.1 AA — collapsible cards and nav are keyboard-operable,
  and the degraded badge is conveyed by text/ARIA, not colour alone.
- **Success signal:** a newcomer can, from a single page, name the repo's architecture, open its
  critical files, run it locally, and start a first task — produced at cents-scale cost with exactly
  one LLM call (visible in logs via `costUsd`).

## Cross-module interactions
A new **`onboarding`** server module (registered in the module registry) generates the artifact and
serves it; a new **client** page under Workspace renders it. The server reaches structural facts only
through the `container.repoIntel` facade and reads cloned-repo files for run/config facts — it never
touches the indexer pipeline directly. The single crossing contract is the **Onboarding JSON**
artifact. Failure contract: the server always returns a well-formed artifact (full, degraded, or
narrative-unavailable) so the client renders a non-empty page in every case.

```mermaid
sequenceDiagram
    participant U as Newcomer (client)
    participant O as onboarding module (server)
    participant RI as container.repoIntel
    participant G as git/clone files
    participant L as LLM (1 structured call)
    U->>O: request onboarding (repo)
    O->>RI: index state, rank, critical paths
    O->>G: package.json / lockfile / compose / .env.example / git log
    alt index degraded or facts insufficient
        O-->>U: deterministic skeleton + degraded badge
    else facts sufficient
        O->>L: ONE structured call over bounded facts
        alt LLM ok
            O->>O: grounding gate strips unknown refs; log costUsd; cache by (repo, headSha)
            O-->>U: full 5-section Onboarding
        else LLM fails
            O-->>U: skeleton + "narrative unavailable" flag
        end
    end
```

## Contracts
Interface-level shapes only (field names illustrative; no implementation prescribed).

- **Generate:** create/refresh onboarding for a repo, with a "force regenerate" option.
  - success → `Onboarding`
  - `422` when no onboarding model is selected in Settings
  - `429` when the per-repo rate limit is exceeded
- **Fetch:** read the cached onboarding for a repo.
  - success → `Onboarding`; not-found when nothing has been generated yet.
- **`Onboarding`** (shape):
  - `repoName: string`
  - `filesIndexed: number`
  - `generatedAt: timestamp`
  - `headSha: string` — cache key component (new; today's `onboarding` table is keyed by repo only)
  - `degraded?: boolean`, `degradedReason?: string`
  - `narrativeUnavailable?: boolean`
  - `sections`:
    - `architecture`: `{ overview: string; style: enum; diagram: { nodes: Node[]; edges: Edge[] } }`
      where `Node = { id; label; kind: 'file'|'package'|'service'|'overflow' }`, `Edge = { from; to; label? }`
    - `criticalPaths`: `Array<{ file: string; rationale: string; link: string }>` (5–8, file-kind only)
    - `howToRun`: `Array<{ step: number; command: string }>`
    - `readingPath`: `Array<{ file: string; rationale: string; link: string }>` (rank-ordered)
    - `firstTasks?`: `Array<{ title; suggestedPath; gapType; rationale; patternPointer; complexity }>`
      (2–3; omitted with an honest message when no gap is found)

## Untrusted inputs
Yes. The feature reads repo-authored text it does not control: README / CLAUDE.md prose,
`package.json` content, `.env.example` variable **names**, and short file extracts. These are treated
strictly as **data, never instructions** — wrapped as untrusted regions in the single prompt (AC-7).
The grounding gate (AC-6) is the second, mandatory barrier: any file/package/service the model names
that is not in the deterministically collected fact set is discarded before the artifact is returned.
Only variable names (never `.env` secret values) are read for How-to-run.

## Resolved clarifications (confirmed with the user)
All six open points below were put to the user and **confirmed exactly as proposed**; they are
binding decisions, not assumptions.
- **Hotness source — RESOLVED:** hotness is computed from local `git log` on the already-cloned repo
  over a fixed recent window (**90 days**), degrading to hotness = 0 when history is unavailable. No
  GitHub commit-activity API call. (User confirmed; aligns with the fork's local-first, zero-LLM-cost,
  degrade-first philosophy.)
- **Un-indexed / not-locally-cloned repo — RESOLVED:** yields the deterministic degraded skeleton
  (honest badge + Regenerate affordance); never a hard block, never an auto-index. (User confirmed.)
- **Large repos — RESOLVED:** the same single-call, bounded-fact path applies (diagram nodes 5–8 +
  overflow; hotness computed only on top-N ranked files; no full-file contents sent); no size-tiered
  branch and no separate hard cost ceiling beyond the single-call constraint. (User confirmed.)
- **Share link — RESOLVED:** copies the internal onboarding URL to the clipboard; no token/public-link
  infrastructure. (User confirmed.)
- **Section depth caps — RESOLVED:** Critical paths 5–8, Guided reading path 3–5, First tasks 2–3.
  (User confirmed.)
- **Cache / regeneration — RESOLVED:** cache key is **`(repoId, headSha)`**, requiring one additive
  `headSha` column on the existing (currently write-less) `onboarding` table; Regenerate forces a
  fresh generation; a per-repo lock prevents duplicate LLM charges; rate limit is 10/min per repo.
  (User confirmed.)
- **Model selection — RESOLVED:** the onboarding feature requires an explicitly selected model (422 if
  unset); this spec does not change model resolution for any other existing feature. (User confirmed.)

## Assumptions
- None outstanding — every open decision was resolved with the user (see *Resolved clarifications*).

## Proposals (out of scope)
- [PROPOSAL: Retrofit strict feature-model resolution (422 on missing override) across all existing
  feature call-sites and remove silent defaults — the reference fork bundled this, but it is broader
  than onboarding and safer as its own change.]
- [PROPOSAL: Real shareable links backed by a token (optionally public/unauthenticated) so the tour can
  be shared outside the workspace — needs an access-control decision and storage.]
- [PROPOSAL: A "Start task" affordance on First tasks that scaffolds the suggested file from its pattern
  pointer — currently First tasks are advisory only.]
- [PROPOSAL: Offer a GitHub commit-activity API as an alternative hotness source for repos whose local
  clone lacks full history (shallow clones).]

## Open questions
- None. All clarification points were put to the user interactively and confirmed (see *Resolved
  clarifications*).
