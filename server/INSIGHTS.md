# Insights — server

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

- **2026-07-05** — No-DB route smoke tests: pass a minimal mock `db` object to `buildApp` (`opts.db`) plus a full `RepoIntel` mock via `ContainerOverrides` — postgres-js connects lazily so no real Postgres is needed, auth is bypassed by `MockAuthProvider`, and `reapStaleRuns` is try/catch-wrapped so the mock db's missing `.update()` throwing is non-fatal. The mock must implement ALL `RepoIntel` interface methods or tsc fails. Evidence: `server/test/blast-route.test.ts`.

## What Doesn't Work

- **2026-07-07** — Resolving "the workspace's repo" with `SELECT … FROM repos WHERE workspace_id = ? LIMIT 1` and no `ORDER BY` is heap-order nondeterministic — live verification got a seed repo whose clone didn't exist on disk, failing attach-time path validation. Pattern now: accept an explicit `repoId` (threaded from the client's `useActiveRepo`), else fall back to `ORDER BY createdAt` preferring a repo whose clone dir `stat()`s. Evidence: `server/src/modules/agents/service.ts` (`resolveCloneRoot`).

## Codebase Patterns

- **2026-07-03** — LLM-structured output that gets persisted and later re-injected into another LLM prompt as trusted context (`pr_intent` → review prompt scoping in `run-executor.ts`) must be re-validated with the contract Zod schema right before persist (`Intent.parse(result.data)`) — `completeStructured`'s internal validation is adapter-specific, not an independent integrity check at the trust boundary. Flagged by the Security Reviewer agent on PR #6. Evidence: `server/src/modules/intent/service.ts:117`.

- **2026-06-25** — Smart Diff (`GET /pulls/:id/smart-diff`) is purely deterministic — zero LLM calls. `classifier.ts` runs RegExp patterns from `constants.ts` to assign `core|wiring|boilerplate`; `service.ts` fetches `prFiles` + the single most-recent `reviews` row (latest by `createdAt desc limit 1`) and joins its `findings` by `reviewId`. Pattern constants and `TOO_BIG_THRESHOLD` live in `constants.ts` so tuning never touches logic files. Evidence: `server/src/modules/smart-diff/`.

- **2026-06-18** — `POST /skills/import` must be registered BEFORE `GET /skills/:id` in Fastify routes, otherwise Fastify matches the literal segment `import` as a UUID param and returns 422. Fixed by registering the static path first. Evidence: `server/src/modules/skills/routes.ts:60`.
- **2026-06-18** — Skills wiring in reviews: `run-executor.ts` fetches `agentsRepo.linkedSkills(agent.id)`, filters to `.skill.enabled`, and passes the bodies as `{ skills: skillBodies }` to `reviewPullRequest()`. `assemblePrompt` in reviewer-core renders `## Skills / rules` automatically when the array is non-empty — no reviewer-core changes needed. Evidence: `server/src/modules/reviews/run-executor.ts`.

- **2026-07-06** — The reviewer pipeline can be driven with zero DB/Fastify: `src/cli/pre-review.ts` is a plain composition root that wires `DiffSource` (git diff via `execFile`) + `parseUnifiedDiff` + an LLM adapter straight into reviewer-core's `reviewPullRequest`. The cost of skipping the DB: no agent system prompt (hardcoded `DEFAULT_SYSTEM_PROMPT`) and no repo-intel enrichment (`skills`/`callers`/`repoMap`/`intent` simply omitted — prompt sections are absent, nothing throws). Evidence: `server/src/cli/pre-review.ts`.

- **2026-07-06 (later)** — **Supersedes the location in the two 2026-07-06 CLI entries above and in Tool & Library Notes:** the pre-review CLI moved out of this package into `mcp-server/src/cli/` and is now invoked as `devdigest review --mode working` (bin installed via `npm link` in `mcp-server/`). `server/src/cli/` is deleted and the `pre-review` npm script removed (tests 176 → 162). File mapping: `pre-review.ts` → `review.ts`, `pre-review.test.ts` → `review.test.ts`; the grounding-gate fixture constraint and tsx-tsconfig-CWD gotcha still apply at the new paths. Evidence: `mcp-server/src/cli/review.ts`, `docs/plans/PLAN-pre-review-cli-bug-fix.md`.
- **2026-06-14** — Shared contracts (`@devdigest/shared`) are vendored as TWO hand-maintained copies — `server/src/vendor/shared/` and `client/src/vendor/shared/` — resolved by tsconfig path alias, NOT auto-synced. Adding a field means editing both in lock-step; the only diffs between copies are comments. Evidence: `server/src/vendor/shared/contracts/trace.ts`, `platform.ts`.
- **2026-06-14** — PR-list per-PR aggregates (score, cost) are computed ON READ in `GET /repos/:id/pulls` via one `inArray` query + JS grouping, never denormalized onto `pull_requests`. "Latest review batch" cost has no batch id in the schema — approximated by summing `agent_runs.cost_usd` within a 120s window of the PR's newest priced run. Evidence: `server/src/modules/pulls/routes.ts`.
- **2026-06-14** — `completeAgentRun`'s `values` shape is declared in TWO places that must match: the repo fn (`repository/run.repo.ts`) AND the interface wrapper (`repository.ts:151`). Adding a field (e.g. `costUsd`) needs both or typecheck fails.
- **2026-06-17** — PR-list `GET /repos/:id/pulls` returns the latest batch's FINDINGS as full `Finding[]` records (not counts) under `PrMeta.findings`, mapped via `reviews/helpers.ts#findingRowToDto`; the client derives severity chips AND renders a hover popover from that one array (no second fetch, perfect chip↔popover consistency). The "latest review batch" here is a SEPARATE window from the cost block: cost windows over `agent_runs.ranAt`, findings windows over `reviews.createdAt` (both 120s). A pre-existing `rollupSeverities` helper in `modules/pulls/status.ts` (lowercase keys) was built for a counts-only variant — currently unused by the route. Evidence: `server/src/modules/pulls/routes.ts`.

## Tool & Library Notes

- **2026-07-06** — Drizzle's `selectDistinct()` is a separate method from `select()` — the no-DB mock in `blast-route.test.ts` stubs only `select()`, so any test that reaches `BlastRepository.findPriorPrsTouchingSameFiles` on a mock db throws. The route survives because the PR lookup 404s before the repository is called; a future happy-path smoke test with a mock db must also stub `selectDistinct` (and `innerJoin` chaining). Evidence: `server/src/modules/blast/repository.ts`, `server/test/blast-route.test.ts`.
- **2026-06-14** — New DB columns: edit `db/schema/*.ts`, then `npm run db:generate` (drizzle-kit) auto-generates `00NN_*.sql` (e.g. `0010_solid_baron_zemo.sql` = `ALTER TABLE … ADD COLUMN`). Never hand-write migration SQL; apply with `npm run db:migrate`.
- **2026-06-25** — **Supersedes above for column renames:** `drizzle-kit generate` opens an interactive TTY prompt when it detects a possible column rename — piping input doesn't work in non-TTY environments. For renames, write the migration SQL manually (use `ALTER TABLE … RENAME COLUMN old TO new`) and add a matching entry to `meta/_journal.json` with the next `idx`. Evidence: `server/src/db/migrations/0014_intent_layer.sql`, `server/src/db/migrations/meta/_journal.json`.

- **2026-07-06** — Tests that feed a canned `Review` through `MockLLMProvider` (`adapters/mocks.ts`) into `reviewPullRequest` must craft the fixture so each finding's `file` AND `start_line` land inside the test diff's hunk lines — otherwise reviewer-core's grounding gate silently drops the finding and the assertion fails with zero findings, not an error. Evidence: `server/src/cli/pre-review.test.ts`, `reviewer-core/src/grounding.ts`.
- **2026-07-06** — `tsx` resolves `@devdigest/*` path aliases from the tsconfig at the CWD — `npm run pre-review` works from `server/`, but invoking `src/cli/pre-review.ts` from any other directory needs an explicit `tsx --tsconfig server/tsconfig.json`. Evidence: `server/package.json` (`pre-review` script).
- **2026-07-07** — `npm run depcruise` does NOT exist: `dependency-cruiser` is a devDependency but there is no npm script and no `.dependency-cruiser.cjs` config, so plans/skills referencing the depcruise architecture gate cannot actually run it. Onion-boundary checks must be done by source inspection until the script+config are added. Evidence: `server/package.json:25`.

## Recurring Errors & Fixes

- **2026-06-14** — Adding a required field to a Zod contract (`RunStats.cost_usd`) breaks the inline fixture in `server/test/contracts.test.ts` (RunTrace parse). Update the `stats: {…}` fixture in the same change. Evidence: `server/test/contracts.test.ts:160`.
- **2026-07-07** — `db/migrations/meta/` is missing snapshots 0012–0014, so `db:generate` diffs the schema against snapshot 0011 and re-detects historical column renames — an interactive TTY prompt plus already-applied ALTERs leak into the new migration. Workaround used for 0015: answer prompts via an `expect` PTY, then strip everything but the genuinely new statements from the generated SQL. `0015_snapshot.json` now captures the full 42-table schema, so future generates diff cleanly. Evidence: `server/src/db/migrations/meta/_journal.json`, `0015_careless_famine.sql`.
- **2026-07-07** — A running dev server does NOT auto-apply new migrations: after a schema-adding commit, routes touching the new tables 500 with `relation "…" does not exist` until a manual `cd server && npm run db:migrate`. If a brand-new endpoint 500s with `internal_error`, check for unapplied migrations first. Evidence: live verification of `agent_documents`/`skill_documents` (migration 0015).
- **2026-06-25** — `reviews/repository/pull.repo.ts` contains hidden `upsertIntent`/`getIntent` helpers that mirror the `Intent` contract shape. When `Intent` fields are renamed (e.g. `intent` → `summary`), this file must be updated alongside the contract — it's easy to miss because it lives inside the `reviews` module, not in `modules/intent/`. Evidence: `server/src/modules/reviews/repository/pull.repo.ts:49-68`.

## Session Notes

### 2026-07-07 (Project Context — in-app document editing)
- Added the feature's first on-disk write surface: `PUT /project-context/documents` → `ProjectContextService.saveDocument` (repo resolution copied verbatim from `previewDocument` — extraction into a shared helper flagged by review, LOW) → `guardPath` → new additive `GitClient.writeFile` port implemented as temp-file+rename in `SimpleGitClient` (no partial write, AC-32). Edits are clone-local and ephemeral by decision: the next `git.sync()` `reset --hard` discards them (AC-31/AC-33).
- Live verification: all four confinement rejects return HTTP 422 (`..` traversal, absolute path, non-`.md`, outside root folders); discovery `size_bytes`/`est_tokens` reflect a save immediately (stat-based, no cache).

### 2026-07-07 (Project Context Folder)
- Built the Project Context Folder feature per `specs/SPEC-2026-07-07-project-context-folder.md` (multi-agent /implement run, 14 tasks): `project-context` module (stat-only discovery via new `GitClient.listDocs` port method + `guardPath` realpath confinement), `agent_documents`/`skill_documents` join tables (migration 0015), ordered path attachments on `GET|POST /agents|skills/:id/documents`, run-time injection via `reviews/context-loader.ts` (agent-first dedup, 20k/40k caps, best-effort skip+log) into reviewer-core's existing `specs` slot. reviewer-core unchanged.
- Live verification (AC-16): a reviewer with an attached invariant spec produced a finding paraphrasing the spec's rule on a violating PR; `specs_read` and `prompt_assembly.specs` populated as designed.
- Review-gate fixes: repoId-scoped clone resolution, dedup + `db.transaction` on attachment writes (duplicate paths previously wiped the set — DELETE committed, INSERT threw on PK), skills route onion violation removed, any-depth root-folder matching per AC-1.

### 2026-07-06 (Pre-review CLI)
- Built local pre-review CLI per `docs/plans/PLAN-local-pre-review-cli.md`: new `src/cli/` tree — `diff-source.ts` (`DiffMode` union `working|staged|branch`, `DiffSource` port, factory throws "not yet implemented" for staged/branch), `diff-sources/working.ts` (`git diff` via promisified `execFile`, "not a git repository" → `GitNotARepoError` code `not_a_repo`), `output.ts` (`renderFindings` stdout / `renderSummary` stderr / `resolveExitCode` with `FailOnPolicy critical|warning|any|never`), `pre-review.ts` composition root. Reviewer-core consumed unchanged. Exit codes: 0 clean, 1 blocking findings, 2 runtime error. 176 server tests green (162 + 14 new).

### 2026-07-06 (Blast architecture remediation)
- Blast module cleaned to onion layering: `routes.ts` stripped to HTTP wiring only (PR lookup + changed-files retrieval moved into new `BlastRepository.findPrByWorkspace` / `getChangedFiles`; `buildBlast` signature is now `(container, workspaceId, prId, log?)` and throws `NotFoundError` itself). `blastRepo` wired as a `Container` lazy getter (agentsRepo pattern) — no more `new BlastRepository(container.db)` in the service. `findPriorPrsTouchingSameFiles` gained a `workspaceId` WHERE guard and a `maxPaths = 50` slice before `inArray`; the prior-PR catch now `log?.warn`s instead of swallowing silently. Repository happy-path tests added for all three methods. 162 server tests green.

### 2026-07-06 (Blast Radius v2)
- Added prior-PR discovery to blast (HW04): new `modules/blast/repository.ts` (`findPriorPrsTouchingSameFiles` — `selectDistinct` join `pull_requests`×`pr_files` on changed paths, excludes current PR, `openedAt desc limit 5`, early-exits `[]` on empty paths with no DB call), `buildBlast` gained a `prId` param and attaches `prior_prs` (snake_case per contract, try/catch → `[]` so blast never throws), route passes `pr.id`. `PriorPr` contract added lockstep to both vendor copies. Zero LLM calls, no migrations. 158 server tests green.
- MCP: `devdigest_get_blast_radius` gained optional `pr_id` UUID param that skips `resolvePullId` (inspector demo shortcut); exactly-one-of validation returns `toolError` otherwise.

### 2026-07-05 (Blast Radius)
- Built Blast Radius (L04) server side: fixed `tryPersistentBlast` caller cap to be per-`viaSymbol` (was global), added `getReachableEndpoints` (reverse-adjacency BFS ≤ depth 2 over `file_edges`, `{}` on any degraded path, never throws) to the `RepoIntel` port + facade, new `modules/blast/` (`GET /pulls/:id/blast`, pure `mapBlast` + `buildBlast` orchestrator). Zero LLM calls; no migrations. 156 server tests green.
- MCP: `devdigest_get_blast_radius` stub replaced with real `resolvePullId` → `client.getBlast` flow.

### 2026-06-25 (Smart Diff)
- Built Smart Diff (L03): `modules/smart-diff/` (constants, classifier, service, routes), `GET /pulls/:id/smart-diff` registered in `modules/index.ts`. No DB migration needed — reads from existing `prFiles` and `findings` tables. Zero LLM calls.

### 2026-06-25
- Built Intent Layer (L03) end-to-end: DB schema migration 0014 (renamed `intent`→`summary`, added `risk_areas`/`model`/`tokens_saved`/timestamps to `pr_intent`), `modules/intent/` module (routes/service/repository), `resolveFeatureModel(…, 'review_intent')` for cheap model, token-savings logging, `container.intentRepo` getter, `run-executor` wired to fetch intent + pass to `reviewPullRequest`.
- Decision: no `workspaceId` on `pr_intent` (follows `pr_brief` precedent — scoping via PR uuid FK is sufficient; workspace guard at route level).
- Updated `reviews/repository/pull.repo.ts` intent helpers to new contract shape.

### 2026-06-18
- Built Skills feature (L02) end-to-end: server module (`modules/skills/` — routes/service/repository/helpers), schema migration 0011 (`message` column on `skill_versions`), `SkillVersion`/`SkillStats`/`SkillImportPreview` contracts (lock-step in both vendor copies), `fflate` for ZIP preview, skills wiring in `run-executor.ts`, seed catalog (8 skills + Test Quality Reviewer agent).
- Decision: `POST /skills/import` registered before `/:id` route to prevent Fastify matching "import" as a UUID param.

### 2026-06-14
- Re-introduced per-run cost (USD) end-to-end (lesson reversing the earlier removal in `d45ab0d`/`58c6ac7`): `cost_usd` column on `agent_runs` (migration 0010), captured in `run-executor` (was discarding `outcome.costUsd`), surfaced in `RunSummary`/`RunStats`/`PrMeta`.
- Decision: PR-list COST = sum of the latest review batch via a 120s window heuristic (no batch id in schema). Cost persisted (accurate `outcome.costUsd`), not recomputed; historical runs → null → "—".

## Open Questions

- **2026-07-06** — Blast summary counts endpoints per-symbol WITHOUT cross-symbol dedupe (`downstream.reduce(sum + d.endpoints_affected.length)`), while the client stat row dedupes via `Set` — PR #7 shows "100 endpoint(s) affected" in the summary text vs "10 endpoints" in the stat chips for the same payload (10 symbols each carry the same 10 seed-level endpoints from `endpointsBySeed`). Should the summary dedupe, or is per-symbol multiplicity intentional signal? Evidence: `server/src/modules/blast/service.ts:67`, `client/.../BlastRadius/helpers.ts:15`.
- **2026-07-06 (later)** — RESOLVED (supersedes the endpoint-dedup question above): `mapBlast` summary now dedupes endpoints across symbols via `new Set(downstream.flatMap((d) => d.endpoints_affected)).size`, matching the client's `blastCounts` Set dedup — summary text and stat chips agree. Evidence: `server/src/modules/blast/service.ts`.
- **2026-06-14** — PR-list "latest review batch" uses a 120s `ranAt` window as a proxy for a review session. If a real review-session / batch id is ever added to the schema, swap the window for exact grouping in `pulls/routes.ts`.
- **2026-07-07** — `SimpleGitClient.writeFile`'s temp+rename can orphan a `.tmp_*` file if the rename fails after a successful temp write, and `git reset --hard` on resync never cleans untracked litter — so failed saves could accumulate files in clone dirs indefinitely (invisible: the non-`.md` suffix hides them from discovery). Architecture review rated it LOW; fix would be a `catch` + `unlink(tmpPath)` around the rename. Evidence: `server/src/adapters/git/simple-git.ts:166`.
