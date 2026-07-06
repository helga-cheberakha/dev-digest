# Plan: Blast Radius — Overview Summary + Architecture Remediation
> Status: READY
> Date: 2026-07-06
> Author: planner agent

## Overview

Two work-streams in one plan. First, the **client Overview-tab rework**: replace the full `BlastRadiusView` on the Overview tab with a compact four-count summary plus a "go to Blast tab" link. Second, **server architecture remediation**: fix eight findings from an architecture review of the Blast Radius feature covering onion-layer violations in `routes.ts`, DI bypass in `service.ts`, a missing workspace_id guard, endpoint-count dedup inconsistency, sparse test coverage, an unbounded `inArray`, and a swallowed error. Client T1 and server T2 are fully independent and can run in parallel on the same branch.

## Requirements → Task coverage

| Requirement | Task(s) |
|---|---|
| Keep section title "Blast Radius Graph" + Graph button → lightbox | T1 |
| Replace `<BlastRadiusView>` with compact 4-count summary (symbols, callers, endpoints, crons) | T1 |
| Counts derived client-side from `BlastRadius` contract; no new fetch | T1 |
| Keep `PriorPrsAccordion` on Overview tab | T1 |
| Add "go to Blast tab" button via callback pattern | T1 |
| New i18n key for go-to-tab button | T1 |
| BlastTab stays exactly as-is | T1 (constraint), T5-OPT (flagged) |
| HIGH: `routes.ts` imports `db/schema` + runs direct `db.select()` + imports from `reviews/repository` — move to service/repository | T2 |
| MEDIUM: `service.ts:99` instantiates `BlastRepository` directly — wire via DI container | T2 |
| MEDIUM: `repository.ts:37-43` `findPriorPrsTouchingSameFiles` has no `workspace_id` guard | T2 |
| MEDIUM: `service.ts:67` summary counts endpoints without cross-symbol dedup | T2 |
| MEDIUM: No cap on changedFiles before `inArray` — unbounded on large PRs | T2 |
| MEDIUM: `service.ts:110` catch block silently swallows prior-PR errors | T2 |
| MEDIUM: `repository.test.ts` only tests empty-paths early return; happy-path untested | T3 |
| LOW: `BlastGraphLightbox` has `role="dialog"` / `aria-modal` but no focus trap | T4 |
| LOW: BlastTab renders no PriorPrsAccordion (feature drift vs Overview) | T5-OPT |
| LOW: `BlastRadiusSection` lateral import of `BlastRadiusView` | Moot after T1 (tracked in Risks) |

## Scope

### Modules affected
- [x] client — T1: BlastRadiusSection compact summary + nav callback threading; T4: BlastGraphLightbox focus trap
- [x] server — T2: routes/service/repository/container architecture cleanup; T3: repository test
- [ ] reviewer-core — not touched
- [ ] e2e — not touched

### Explicitly out of scope
- Changing the `BlastRadius` contract shape (`@devdigest/shared` / vendor copies) — the endpoint-dedup fix changes the summary string value only, not the contract field
- `_components/BlastTab/` — zero changes (see T5-OPT for the PriorPrsAccordion drift question)
- `_components/BlastRadius/` (BlastRadiusView, helpers, constants, styles) — zero changes
- New database migrations
- MCP tool changes
- Any refactoring beyond the listed findings

---

## Engineering Insights from Codebase

### server
- **Onion layer rule** (`onion-architecture` skill): `routes.ts` may import only the service, `_shared`, and contracts. It must NOT import `db/schema` or another module's `repository` file. The violation at `routes.ts:7-8` is a genuine error-level drift.
- **DI via container** (`server/INSIGHTS.md`): All repositories live as lazy getters on `Container` (pattern: `agentsRepo` at `container.ts:101-103`). `ContainerOverrides` must have the optional field so tests can inject mocks. Tests inject mocks; application code must not call `new XRepository(container.db)`.
- **Multi-tenancy** (`server/CLAUDE.md`): Every domain query must include `workspace_id`. The current `findPriorPrsTouchingSameFiles` skips it — a defense-in-depth gap.
- **selectDistinct mock caveat** (`server/INSIGHTS.md:2026-07-06`): `selectDistinct()` is distinct from `select()`. Tests mocking the db must stub both separately with full chain support.
- **Shared contracts are hand-maintained** (`server/INSIGHTS.md:2026-06-14`): Both vendor copies are lockstep-edited. T2's endpoint-dedup fix changes only the `summary` string value — no contract shape change, so no lockstep vendor edit.
- **Endpoint-dedup open question resolved** (`server/INSIGHTS.md` open-questions at line 66): Use Set dedup in `mapBlast`, consistent with `client/.../BlastRadius/helpers.ts:15`.
- **ESM `.js` extensions**: All server relative imports carry `.js` extension even though source files are `.ts`.

### client
- **Import depth** (`client/INSIGHTS.md:2026-07-05`): Seven levels from `_components/<Tab>/` to `src/lib/`. Copy depth from neighbour's import. Imports within `_components/` are short one-level hops.
- **`fireEvent` only** (`client/INSIGHTS.md:2026-07-06`): `@testing-library/user-event` is absent. Use `fireEvent` for all interactions in tests.
- **ResizeObserver stub** (`client/INSIGHTS.md:2026-07-06`): Any test file rendering `BlastGraphLightbox` must define the minimal stub on `globalThis` before render.
- **i18n — only `en`** (`client/INSIGHTS.md:2026-06-14`): Missing keys silently render raw key. New strings must be added to `blast.json` first.
- **Atomic navigation** (`client/INSIGHTS.md:2026-06-25`): `setTab("blast")` in `page.tsx` builds the URL atomically. Thread it as `onGoToBlast: () => void` to keep navigation logic centralised.
- **Icon registry** (`client/INSIGHTS.md:2026-06-18`): Verify icon names against `src/vendor/ui/icons.tsx`. Pre-verified names in `BlastRadius/constants.ts::STAT_ICONS`.
- **Focus management** (react-best-practices accessibility): modals must trap focus and move initial focus to an interactive element on open.

### reviewer-core / e2e
No relevant insights — neither module is touched.

---

## Count derivation (verified against `brief.ts`)

Source: `client/src/vendor/shared/contracts/brief.ts` (read-only vendor file).

| Metric | Field path | Derivation |
|---|---|---|
| Symbols | `BlastRadius.changed_symbols` | `.length` |
| Callers | `BlastRadius.downstream[].callers` | `sum of .length` across all entries |
| Endpoints | `BlastRadius.downstream[].endpoints_affected` | `new Set(flatMap).size` (unique across all symbols) |
| Cron/jobs | `BlastRadius.downstream[].crons_affected` | `new Set(flatMap).size` (unique across all symbols) |

`blastCounts(blast)` in `_components/BlastRadius/helpers.ts` implements this exactly and is exported. Import from `../BlastRadius/helpers.js` (ESM `.js` extension required).

## Navigation callback decision (T1)

Thread `onGoToBlast: () => void` from `page.tsx → OverviewTab → BlastRadiusSection`. Calls `setTab("blast")` in page.tsx.

Rationale: consistent with all other tab switches (setTab is canonical), avoids BlastRadiusSection becoming router-aware, mirrors the established `onWhy` threading pattern. `repoFullName`/`headSha` props are removed simultaneously — they served `BlastRadiusView` only; `BlastGraphLightbox` does not use them.

## New i18n keys (T1)

File: `client/messages/en/blast.json`. Add under root object:
```json
"summary": { "goToTab": "View full Blast Radius" }
```
Existing `stat.*` keys cover the four count labels. No other keys added.

## Server architecture decisions (T2)

**Route refactor**: `buildBlast` absorbs PR lookup and file retrieval. New signature: `buildBlast(container, workspaceId, prId, log?)`. The PR lookup and `getPrFiles` equivalent move into two new `BlastRepository` methods. `routes.ts` drops all `drizzle-orm`, `db/schema`, and `reviews/repository` imports.

**DI fix**: Add `blastRepo` lazy getter to `Container` (same pattern as `agentsRepo` at line 101). Add optional `blastRepo?: BlastRepository` to `ContainerOverrides`. `buildBlast` uses `container.blastRepo`.

**workspace_id guard**: `findPriorPrsTouchingSameFiles` gains `workspaceId: string` as its first parameter. Adds `eq(t.pullRequests.workspaceId, workspaceId)` to the WHERE clause. `buildBlast` supplies the workspaceId it now receives.

**Files cap**: In `BlastRepository.findPriorPrsTouchingSameFiles`, add `maxPaths = 50` as last parameter. Slice paths internally: `const safePaths = paths.slice(0, maxPaths)`. Repository owns the infrastructure concern; the service does not need to know about the cap.

**Endpoint dedup**: In `mapBlast` at `service.ts:67`, replace `downstream.reduce(…d.endpoints_affected.length…)` with `new Set(downstream.flatMap(d => d.endpoints_affected)).size`.

**log.warn**: `buildBlast` gains optional `log?: { warn: (obj: unknown, msg?: string) => void }` as fourth parameter. Route passes `req.log`. Catch block at `service.ts:110` changes to log then reset: `log?.warn({ err: e }, '...')` then `priorPrs = []`.

---

## Implementation Tasks

---

### T1: Client — compact summary on Overview tab  `MODULE: client`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | none |
| **Parallel with** | T2, T4 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `client/messages/en/blast.json` | edit | Add `summary.goToTab` key |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusSection.tsx` | edit | Remove `BlastRadiusView`, add compact count summary + go-to-tab button; update props |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusSection.test.tsx` | edit | Update prop calls, update test 2, add test for go-to-tab button |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` | edit | Add `onGoToBlast` prop; remove `repoFullName`/`headSha` props |
| `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` | edit | Pass `onGoToBlast={() => setTab("blast")}`; remove `repoFullName`/`headSha` from `<OverviewTab>` |

**Approach**

1. Add `"summary": { "goToTab": "View full Blast Radius" }` to `blast.json` first, so that `blastMessages.summary.goToTab` resolves in tests that import the messages file.

2. Update `BlastRadiusSectionProps`: remove `repoFullName: string | null` and `headSha: string | null` (no longer used — `BlastRadiusView` and its `onWhy` closure are gone; `BlastGraphLightbox` does not use these props); add `onGoToBlast: () => void`.

3. Import `blastCounts` from `../BlastRadius/helpers.js`. Do not inline the derivation logic.

4. Replace the `<BlastRadiusView …/>` block with a compact stat row rendering four items using `blastCounts(blast)` for numbers and `t("stat.symbols")` / `t("stat.callers")` / `t("stat.endpoints")` / `t("stat.crons")` for labels. For icon names, optionally import `STAT_ICONS` from `../BlastRadius/constants.js` (pre-verified) or verify names independently in `src/vendor/ui/icons.tsx`. Layout is at the implementer's discretion.

5. Add the "go to Blast tab" button after the compact summary and before `PriorPrsAccordion`. `onClick` calls `onGoToBlast()`. Label: `t("summary.goToTab")`. Style consistently with the Graph button. Render only when `blast` is defined.

6. Keep `BlastGraphLightbox` wiring unchanged: `graphOpen` state, the Graph button, and the `{graphOpen && blast && <BlastGraphLightbox …/>}` mount are untouched.

7. Keep `PriorPrsAccordion` unchanged: `<PriorPrsAccordion priorPrs={blast.prior_prs ?? []} />`.

8. Update `OverviewTab.tsx`: remove `repoFullName: string | null` and `headSha: string | null` from `OverviewTabProps` and destructuring (they were only passed to `BlastRadiusSection`). Add `onGoToBlast: () => void`. Pass `onGoToBlast={onGoToBlast}` to `<BlastRadiusSection>`. The `handleWhy` callback and `onWhy` prop remain — they serve `PrBriefCard`.

9. Update `page.tsx`: in the `<OverviewTab>` JSX block (lines 168–175), remove `repoFullName={repoFullName}` and `headSha={pr.head_sha}`, add `onGoToBlast={() => setTab("blast")}`. `setTab` already exists; no new imports needed. Minimal targeted diff only.

10. Compile: `npx tsc --noEmit` in `client/`. Common pitfalls: missing `.js` on `blastCounts` import; passing props that no longer exist.

**Tests**

| # | Current test name | Action | Change |
|---|---|---|---|
| 1 | "renders Skeleton while loading" | UPDATE props only | Remove `repoFullName`/`headSha`, add `onGoToBlast={vi.fn()}`. Assertion unchanged. |
| 2 | "renders BlastRadiusView when blast data arrives" | RENAME + UPDATE | Rename to "renders compact count summary when blast data arrives". Update props. Assert `queryByText("rateLimit()")` NOT in document; assert `getByText("callers")` IS in document (`t("stat.callers")`). |
| 3 | "renders PriorPrsAccordion when prior_prs is non-empty…" | UPDATE props only | Same prop-only update. Accordion assertions unchanged. |
| 4 | "does not render prior PRs accordion when prior_prs is absent" | UPDATE props only | Same prop-only update. |
| 5 (new) | "go to Blast tab button calls onGoToBlast" | CREATE | Given BLAST data + `onGoToBlast={vi.fn()}`, `fireEvent.click(screen.getByText(blastMessages.summary.goToTab))`, assert mock called once. |

**Definition of done**
- [ ] TypeScript compiles with zero errors in `client/` (`npx tsc --noEmit`)
- [ ] All five `BlastRadiusSection` tests pass (4 updated + 1 new)
- [ ] Overview tab no longer renders `BlastRadiusView` (no `rateLimit()` text, no tree/graph toggle)
- [ ] Graph button and lightbox remain functional (existing `BlastGraphLightbox` tests green)
- [ ] `PriorPrsAccordion` renders and toggles as before
- [ ] `_components/BlastTab/` has zero diff
- [ ] `blast.json` contains the `summary.goToTab` key
- [ ] `npm test` in `client/` exits 0

---

### T2: Server — route layer violation, DI, workspace_id, dedup, cap, log  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | none |
| **Parallel with** | T1, T4 |

**Findings addressed**

| Severity | Finding | Verified location |
|---|---|---|
| HIGH | routes.ts imports `drizzle-orm` (line 4), `db/schema` (line 7), `reviews/repository/pull.repo` (line 8); runs `db.select()` on `pullRequests` (lines 28-36); calls `getPrFiles` (lines 38-39) | routes.ts:4,7,8,28-40 |
| MEDIUM | `buildBlast` calls `new BlastRepository(container.db)` directly | service.ts:99 |
| MEDIUM | `findPriorPrsTouchingSameFiles` WHERE clause has no `workspace_id` guard | repository.ts:37-42 |
| MEDIUM | Summary counts endpoints without cross-symbol Set dedup | service.ts:67 |
| MEDIUM | No cap on paths before `inArray` — full changedFiles array (up to 300+) used | repository.ts:40 |
| LOW | Catch block silently swallows prior-PR errors | service.ts:110 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/src/modules/blast/repository.ts` | edit | Add `findPrByWorkspace()` + `getChangedFiles()` methods; add `workspaceId` param + `maxPaths` cap to `findPriorPrsTouchingSameFiles` |
| `server/src/modules/blast/service.ts` | edit | Update `buildBlast` signature; use `container.blastRepo`; fix endpoint dedup; add `log?.warn` |
| `server/src/modules/blast/routes.ts` | edit | Remove `drizzle-orm`/`db/schema`/`reviews/repository` imports; simplify handler to parse params + call service |
| `server/src/platform/container.ts` | edit | Add `blastRepo` lazy getter + `ContainerOverrides.blastRepo?` field |
| `server/src/modules/blast/repository.test.ts` | edit | Update existing empty-paths test call to match new method signature (workspaceId prepended) |

**Approach**

**Step 1 — Repository: new methods + workspace_id guard + cap**

Add `findPrByWorkspace(workspaceId: string, prId: string): Promise<{ id: string; repoId: string } | undefined>`. Query `pullRequests` with `and(eq(pullRequests.workspaceId, workspaceId), eq(pullRequests.id, prId))`, destructure first element, return it or `undefined`. Replaces the route's lines 28-37.

Add `getChangedFiles(prId: string): Promise<string[]>`. Query `prFiles` where `prFiles.prId === prId`, map rows to `.path`. Replaces the route's `getPrFiles` call at lines 38-39. Both new methods use `db/schema` which `repository.ts` is already allowed to import.

Update `findPriorPrsTouchingSameFiles` signature: prepend `workspaceId: string` as first parameter; append `maxPaths = 50` as last parameter. Add to WHERE clause: `eq(t.pullRequests.workspaceId, workspaceId)`. Inside the method, add before the query: `const safePaths = paths.slice(0, maxPaths)` and use `safePaths` in `inArray`. The existing `paths.length === 0` early-exit remains (check `paths.length` before slicing, or equivalently — `if (paths.length === 0) return []` before any slicing).

Update `repository.test.ts` existing test at line 11: change `findPriorPrsTouchingSameFiles('repo-1', 'pr-1', [], 5)` to `findPriorPrsTouchingSameFiles('ws-1', 'repo-1', 'pr-1', [], 5)`.

**Step 2 — Container: DI wiring**

Import `BlastRepository` at the top of `container.ts` (follow the `AgentsRepository` import pattern at line 26 as a model).

Add to `ContainerOverrides` interface:
```
blastRepo?: BlastRepository;
```

Add private field `private _blastRepo?: BlastRepository` to the `Container` class body.

Add getter:
```
get blastRepo(): BlastRepository {
  if (this.overrides.blastRepo) return this.overrides.blastRepo;
  return (this._blastRepo ??= new BlastRepository(this.db));
}
```

**Step 3 — Service: new `buildBlast` signature + fixes**

Update `buildBlast` signature:
```
export async function buildBlast(
  container: Container,
  workspaceId: string,
  prId: string,
  log?: { warn: (obj: unknown, msg?: string) => void },
): Promise<BlastRadius>
```

Remove the old `repoId: string` and `changedFiles: string[]` parameters (these are now derived internally).

Inside the body, after the `Promise.all` block, add before it:
```
const pr = await container.blastRepo.findPrByWorkspace(workspaceId, prId);
if (!pr) throw new NotFoundError('Pull request not found');
const changedFiles = await container.blastRepo.getChangedFiles(pr.id);
```
Import `NotFoundError` from `../../platform/errors.js` (add the import at the top of service.ts).

Replace `const repo = new BlastRepository(container.db)` (line 99) and its usage: call `container.blastRepo.findPriorPrsTouchingSameFiles(workspaceId, pr.repoId, prId, changedFiles, 5, 50)` directly inside the try block (no intermediate `repo` variable needed).

Catch block (line 110 area): change to:
```
} catch (e: unknown) {
  log?.warn({ err: e }, 'blast: prior-PR discovery failed — continuing without');
  priorPrs = [];
}
```

Also in `mapBlast` at line 67: replace `downstream.reduce((sum, d) => sum + d.endpoints_affected.length, 0)` with `new Set(downstream.flatMap((d) => d.endpoints_affected)).size`.

**Step 4 — Routes: strip to HTTP wiring only**

Delete import lines 4, 7, 8 (drizzle-orm, db/schema, reviews/repository).

Simplify the route handler body to:
```
const { workspaceId } = await getContext(app.container, req);
return buildBlast(app.container, workspaceId, req.params.id, req.log);
```
`NotFoundError` is now thrown from `buildBlast`; the route does not need to import it directly (Fastify's error handler already handles it via the existing error middleware).

**Step 5 — Verify blast-route.test.ts compatibility**

Read `server/test/blast-route.test.ts` before implementation. The test currently mocks `db` with a `select()` call that returns `[]` (causing a 404 in the route). After the refactor, the same `db.select()` is called from `BlastRepository.findPrByWorkspace()` — same chain, same mock behavior → still 404. If the test has a success path that mocks the PR lookup to return a row, the mock must also handle the `getChangedFiles` call (another `db.select().from(prFiles).where(...)`). Extend the mock accordingly.

**Tests**
- Existing `server/test/blast-route.test.ts` — must remain green
- Existing `server/src/modules/blast/repository.test.ts` — existing test updated in Step 1
- `mapBlast` unit coverage (if referenced in `server/test/contracts.test.ts`) — verify no snapshot on the summary string format

**Definition of done**
- [ ] TypeScript compiles with zero errors in `server/` (`npx tsc --noEmit`)
- [ ] `routes.ts` has zero imports from `drizzle-orm`, `db/schema`, or `reviews/repository`
- [ ] `service.ts` has zero `new BlastRepository(...)` direct instantiations
- [ ] `container.ts` has a `blastRepo` lazy getter and `ContainerOverrides.blastRepo?` field
- [ ] `findPriorPrsTouchingSameFiles` WHERE clause includes `eq(workspaceId, ...)` guard
- [ ] `findPriorPrsTouchingSameFiles` slices paths to `maxPaths` (default 50) before `inArray`
- [ ] `mapBlast` summary uses `Set` dedup for endpoint count (line 67)
- [ ] Catch block at service.ts:110 logs via `log?.warn(...)` before resetting `priorPrs`
- [ ] `npm test` in `server/` exits 0; existing blast-route test passes

---

### T3: Server — BlastRepository happy-path tests  `MODULE: server`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | T2 |
| **Parallel with** | none |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `server/src/modules/blast/repository.test.ts` | edit | Add happy-path tests for all three repository methods |

**Approach**

1. The existing empty-paths test (updated by T2 to have the new signature) remains as-is.

2. Add happy-path test for `findPriorPrsTouchingSameFiles`:
   - Build a minimal chained mock stub for `selectDistinct().from().innerJoin().where().orderBy().limit()` using `vi.fn()` chain where each method returns the next builder object and `.limit()` returns a resolved Promise with a fixture row.
   - Fixture row: `{ id: 'pr-2', number: 99, title: 'Old fix', openedAt: new Date('2026-01-01'), status: 'merged' }` (matching the five projected columns in repository.ts:28-32).
   - Given: `workspaceId='ws-1', repoId='repo-1', excludePrId='pr-1', paths=['src/foo.ts'], limit=5`.
   - Assert return value equals `[fixtureRow]`. Assert `db.selectDistinct` was called.

3. Add happy-path test for `getChangedFiles`:
   - Mock `db.select().from().where()` → resolves to `[{ prId: 'pr-1', path: 'src/foo.ts', ...other columns }]`.
   - Assert method returns `['src/foo.ts']`.

4. Add tests for `findPrByWorkspace` (found case and not-found case):
   - Found: `db.select().from().where()` → `[{ id: 'pr-1', repoId: 'repo-1', workspaceId: 'ws-1' }]` → assert returns `{ id: 'pr-1', repoId: 'repo-1' }` (only the projected fields).
   - Not found: stub returns `[]` → assert method returns `undefined`.

Note on mock structure: `db.select()` returns a builder; `.from()` returns a builder; `.where()` returns a Promise (or a builder with a `.then` for Drizzle). Drizzle query builders are thenable — mock `.where()` to return a `Promise.resolve([fixture])` or add a `.then` property. Look at the existing mock pattern in the test before writing new ones.

**Tests** — `npm test` in `server/` must exit 0 with all new tests passing.

**Definition of done**
- [ ] `repository.test.ts` covers: empty-paths early return, `findPriorPrsTouchingSameFiles` happy path, `getChangedFiles` happy path, `findPrByWorkspace` found + not-found
- [ ] TypeScript compiles with zero errors in `server/`
- [ ] `npm test` in `server/` exits 0

---

### T4: Client (LOW) — BlastGraphLightbox focus trap  `MODULE: client`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | none |
| **Parallel with** | T1, T2 |

**Files to touch**

| File | Action | Reason |
|---|---|---|
| `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastGraphLightbox.tsx` | edit | Add initial focus on open + Tab key interceptor |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastGraphLightbox.test.tsx` | edit | Add focus management tests |

**Approach**

1. Add a `closeButtonRef = React.useRef<HTMLButtonElement>(null)` and attach it to the close button element.

2. Add a `useEffect` (runs once on mount) that calls `closeButtonRef.current?.focus()` to move focus into the dialog when it opens (WCAG 2.4.3).

3. Add a `dialogRef = React.useRef<HTMLDivElement>(null)` and attach it to the `<div role="dialog">` element.

4. Inside the existing keydown `useEffect` (or a new one), add Tab-trap logic:
   - On `keydown`, if `e.key === 'Tab'`: query `dialogRef.current` for all focusable descendants (`button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`), filter to elements that are not hidden and not disabled.
   - If `e.shiftKey` and focus is on the first focusable element: `e.preventDefault(); lastFocusable.focus()`.
   - If `!e.shiftKey` and focus is on the last focusable element: `e.preventDefault(); firstFocusable.focus()`.
   - The current dialog has exactly one focusable element (the close button) — the cycle is trivially correct and becomes richer automatically if more controls are added.

5. No new dependencies. Use vanilla DOM `querySelectorAll` inside the effect.

**Tests**

The `ResizeObserver` stub is already in `BlastGraphLightbox.test.tsx:10-18` — do not add a second `beforeAll`. Add two new tests:

- "close button receives initial focus on open": after `renderWithIntl(...)`, assert `document.activeElement` has `aria-label` matching the close button. Use `toHaveAttribute` or role query.
- "Tab key does not move focus outside the dialog": `fireEvent.keyDown(document, { key: 'Tab' })` → assert `document.activeElement` is still within the dialog (or is the close button). With a single focusable element, this verifies the trap logic cycles rather than escaping.

**Definition of done**
- [ ] On lightbox open, focus moves to the close button
- [ ] Tab/Shift+Tab does not escape the dialog
- [ ] Existing ESC-key and overlay-click tests remain green
- [ ] TypeScript compiles with zero errors in `client/`
- [ ] All `BlastGraphLightbox` tests pass (3 existing + 2 new)
- [ ] `npm test` in `client/` exits 0

---

### T5-OPT: BlastTab — PriorPrsAccordion feature drift  `[OPTIONAL — NEEDS USER DECISION]`

| Field | Value |
|---|---|
| **Agent** | `implementer` |
| **Depends on** | T1 (if approved) |
| **Parallel with** | T2, T3, T4 after T1 completes |

**Ambiguity**: The user's directive was "leave BlastTab exactly as it is." The reviewer found that `BlastTab` does NOT render `PriorPrsAccordion`, while the Overview section does (both share the `["blast", prId]` query key and therefore the same data). This is feature drift.

Interpretation of "leave as is":
- Conservative: do not change `BlastTab.tsx` at all — the directive is absolute.
- Liberal: "leave the main BlastRadiusView unchanged" was the intent; adding PriorPrsAccordion to BlastTab would be additive and consistent with the data already available.

**This task is NOT planned as required.** It is documented here so the user can make an explicit decision. Do NOT implement T5-OPT without explicit user approval.

If approved: import `PriorPrsAccordion` from `../OverviewTab/PriorPrsAccordion.js` in `BlastTab.tsx`, add `{blast && <PriorPrsAccordion priorPrs={blast.prior_prs ?? []} />}` after `<BlastRadiusView>`. Update `BlastTab.test.tsx` with a test for accordion rendering. No new data fetching needed.

---

## Parallelisation map

```
T1 (client: Overview summary) ──────────────────────────────────────────────────┐
T2 (server: arch cleanup)     ──────────────────────────────────────────┐        ├──► all done
T4 (client LOW: focus trap)   ──────────────────────────────────────────┘        │
                                                                                  │
T2 ──► T3 (server: repo tests) ─────────────────────────────────────────────────┘

T5-OPT (awaiting explicit user decision — do not start)
```

T1, T2, T4 can run in parallel — they operate in different packages or on non-overlapping files within the client package. T3 depends on T2 because T2 changes the `BlastRepository` method signatures exercised by T3's tests.

**File conflict check**

| File | Assigned to | Parallel tasks | Conflict? |
|---|---|---|---|
| `client/messages/en/blast.json` | T1 | T4 | No conflict — T4 does not touch blast.json |
| `OverviewTab/BlastRadiusSection.tsx` | T1 | T4 | No conflict — T4 touches BlastGraphLightbox.tsx |
| `OverviewTab/BlastRadiusSection.test.tsx` | T1 | T4 | No conflict — T4 touches BlastGraphLightbox.test.tsx |
| `OverviewTab/OverviewTab.tsx` | T1 | T4 | No conflict |
| `pulls/[number]/page.tsx` | T1 | T4 | No conflict |
| `OverviewTab/BlastGraphLightbox.tsx` | T4 | T1 | No conflict |
| `OverviewTab/BlastGraphLightbox.test.tsx` | T4 | T1 | No conflict |
| `server/src/modules/blast/routes.ts` | T2 | T1, T4 | No conflict (different package) |
| `server/src/modules/blast/service.ts` | T2 | T1, T4 | No conflict (different package) |
| `server/src/modules/blast/repository.ts` | T2 | T3 | No conflict — T3 only touches repository.test.ts |
| `server/src/platform/container.ts` | T2 | T1, T3, T4 | No conflict |
| `server/src/modules/blast/repository.test.ts` | T2 (update existing test sig) then T3 (add tests) | — | Resolved: T3 depends on T2 |

---

## Risks

- **`blast-route.test.ts` mock compatibility**: after T2, the route calls `buildBlast(container, workspaceId, req.params.id, req.log)` and `buildBlast` calls `container.blastRepo.findPrByWorkspace()` which calls `db.select()`. If the test mock returns an empty array (current behavior → 404), the test still passes. If the test has a success-path case, the mock must also handle the subsequent `getChangedFiles` `db.select()` call. Read the test before implementing T2 — extend the mock if necessary.
- **BlastTab PriorPrsAccordion drift (T5-OPT)**: not implemented without user approval. Flagged as ambiguous per the "leave BlastTab as-is" directive.
- **`BlastRadiusSection.tsx` lateral import of `BlastRadiusView`**: after T1 removes this import, `BlastRadiusView` has exactly one consumer (`BlastTab`). Promotion to `src/components/` is not warranted (promote only when a second consumer appears — frontend-architecture skill). Moot after T1.
- **log.warn injection pattern**: the `log?` parameter on `buildBlast` is a pragmatic stopgap. If the codebase later adds a logger to `Container`, this parameter should be removed in favour of `container.log`. Add an inline TODO comment noting this.
- **Endpoint dedup changes MCP tool output**: `blast.summary` now counts unique endpoints across all symbols. MCP tool output that embeds the summary string will reflect the deduplicated count. This is correct behavior but verify no snapshot tests assert the exact old summary format.
- **Drizzle mock chaining in T3**: `selectDistinct()` returns a query builder, not a plain Promise. The mock chain must support `.from().innerJoin().where().orderBy().limit()` returning a resolved Promise at the terminal `.limit()` call. If Drizzle builders implement `.then`, mock `.where()` returning a thenable (with `.then = vi.fn(cb => Promise.resolve([fixture]).then(cb))`). The existing repository test uses a different mock style (bare `{ selectDistinct: vi.fn() }`) — read it before building the happy-path mock.

## Global definition of done
- [ ] All existing tests pass across client and server modules
- [ ] TypeScript compiles with zero errors in `client/` and `server/`
- [ ] Requirements → Task coverage table is complete (no uncovered rows)
- [ ] File conflict check table shows no unresolved conflicts
- [ ] T5-OPT is explicitly marked as not started (awaiting user decision)
- [ ] Plan marked `Status: READY`
