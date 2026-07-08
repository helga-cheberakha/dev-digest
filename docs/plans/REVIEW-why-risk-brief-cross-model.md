> Cross-model review note (SDD step 2b). Reviewer: **GPT-5** (manual run by Helga, model of another
> family, acting as staff engineer with ONLY the spec + plan as context — no access to this chat).
> Input packet: staff-engineer prompt + specs/SPEC-2026-07-07-why-risk-brief.md +
> docs/plans/PLAN-why-risk-brief.md (as of commit c4d120f). Date: 2026-07-07.
> Verdict: REQUEST CHANGES — 3 blockers, 6 majors, 6 minors. Plan revised accordingly (see the
> revision note at the top of PLAN-why-risk-brief.md).

# Cross-model plan review — Why+Risk Brief

## Verdict: REQUEST CHANGES

## Blockers (must fix before implementation)

- **B1 — Per-task `tsc` gates are unsatisfiable as written; the DAG hides coupling through T1's breaking changes.**
  T1 deletes `PrBrief`, removes `Intent.risk_areas`, and narrows `Risk.kind`, and the plan itself admits this "will surface `tsc` errors in consumers (`IntentCard.tsx:114`, `intent`/`reviews` modules, `PrBriefCard`) — those are fixed in T7/T10/T11". Yet:
  - T3/T4 acceptance says "`cd server && npx tsc --noEmit` passes" / "compiles", but server `tsc` cannot pass until **T7** lands (intent module still references `riskAreas`). T3/T4 do not depend on T7.
  - T9 acceptance says "`cd client && npx tsc --noEmit` passes", but client `tsc` cannot pass until **T10/T11** land (old `PrBriefCard` still uses composed `PrBrief`; `IntentCard` still reads `risk_areas`).
  - The Testing strategy declares full-package typecheck "every task's gate", directly contradicting T1's own caveat "(Full-package tsc goes green once T7/T10/T11 land)".
  In a multi-agent run where gates decide task completion, this deadlocks or gets silently waived. Fix by either (a) adding DAG edges (T7 before/with T3–T6; T10/T11 before T9's gate — or restating T9's gate as file-scoped), or (b) explicitly redefining each task's gate as scoped `tsc` on owned paths with one final full-package gate task.

- **B2 — AC-17 is never verified against the real locking primitive, and the double-checked read silently assumes READ COMMITTED.**
  T14 says the advisory lock "must be stubbed on the mock db (or the concurrency test drives two real serialized calls through an injected lock stub)". A stubbed lock tests the stub — the actual `pg_advisory_xact_lock(hashtext($prId))` + `db.transaction` interaction (lock pinned to one pooled connection, waiter re-read visibility) has **zero** real coverage for a spec-level gate AC ("_observable: it — two concurrent POSTs → LLM invocation count = 1_"). Worse: the waiter's "re-read cache inside the lock" only sees the winner's committed row under READ COMMITTED; under REPEATABLE READ the waiter's snapshot predates the commit and it fires a second LLM call — violating AC-17. Nothing in T3/T5 pins or asserts the isolation level. Require: one integration test against real Postgres (even a single serialized-pair test) and an explicit isolation-level note/assertion in T3.

- **B3 — The plan contradicts the spec's *binding* `buildBlast` entry point.**
  Spec, *Binding entry points (verified)*: "`buildBlast(db, prId)`". Plan T5: "`buildBlast` signature is `(container, workspaceId, prId, log?)`". Both claim verification; one is wrong. For a parallel dispatch where implementers get the plan as ground truth, an incorrect binding signature (or an un-flagged spec correction) is exactly the "API mismatch that bites during implementation". Resolve and record which is true — if the plan re-verified against the codebase, say so explicitly and mark the spec note superseded.

## Majors (should fix)

- **M1 — AC-7 mislabeled in T4/T13 corrupts traceability.** AC-7 is "*headSha differs → cache invalid → regenerate*". T4 lists "Covers: … AC-7 (untrusted wrapping)" and T13 asserts "AC-7 (each untrusted region is delimited/wrapped)". Untrusted wrapping is a Non-functional/Untrusted-inputs requirement, not AC-7. The Red-flags claim "Every requirement maps to a task" is therefore built on a wrong mapping (AC-7 is genuinely covered — by T14 — but the matrix lies). Introduce an explicit requirement ID for untrusted wrapping instead of squatting on AC-7.

- **M2 — AC-2's test oracle will false-fail (or be gamed).** T13 asserts "payload contains no `@@`/`+`/`-` body rows". Spec text and intent text legitimately contain lines starting with `-` (markdown bullets — the Context-Folder docs are `.md`). Either the fixtures dodge markdown lists (test proves nothing) or the assembler must strip legal content to satisfy a naive regex. Rework the oracle: feed fixtures that *include* markdown bullets plus a known hunk fixture, and assert hunk *structure* (e.g. `@@ -n,+m @@` headers, paired +/− runs) is absent while bullet content survives.

- **M3 — Lock-before-read on every request: no unlocked fast path, unbounded blocking, pool pinning.** The plan calls the design "double-checked", but T5 takes `withPrLock` before the *first* cache read — that is single-checked-inside-lock. Consequences: every ordinary page-load POST opens a transaction and queues behind any in-flight generation; `pg_advisory_xact_lock` has no timeout, so a hung LLM call blocks all subsequent requests for that PR *and* each waiter pins a pooled connection (postgres-js pool exhaustion under a handful of concurrent PRs). Add a lock-free cache read first (true double-check), and state a timeout/abort strategy for the LLM call inside the lock. The "Risks" section names the tradeoff but offers no mitigation beyond "accepted".

- **M4 — T12 writes into T10-owned `prBrief.json`, breaking the plan's own invariant.** T12: "Add any new i18n keys to `prBrief.json` (owned by T10 — coordinate; T12 consumes)". "Owned paths" is the stated merge-safety rule for multi-agent execution; "coordinate" is not a mechanism. Since T12 depends on T10 it's sequentially safe — so either transfer ownership of the file to T12 at that phase, or require T10 to pre-register all keys T12 needs.

- **M5 — `chars/4` estimation vs. a hard ≤8000-token handoff criterion.** AC-3 and the Process section demand "LLM input ≤ 8K tokens **on a real run**". A chars/4 heuristic under-counts for code-ish spec text; a payload that "measures" 8000 estimated can exceed 8000 real tokens. Cap the estimate at a margin (e.g., 7200–7500) or use a real tokenizer; state which in T4.

- **M6 — T17's determinism depends on an unspecified seeding path.** "Seed/select a PR that already has a cached Brief" — there is no described fixture mechanism for inserting a `pr_brief` row (and matching `head_sha`) into the e2e environment. Without it, the e2e either triggers a live LLM call (forbidden: "no LLM") or flakes. Specify the seed step (direct DB insert in the e2e setup) as part of T17.

## Minors / nits

- **m1** — `hashtext(prId)` uses the global advisory-lock int keyspace; future features colliding is plausible. Prefer the two-argument form `pg_advisory_xact_lock(classid, objid)` with a feature-namespace constant.
- **m2** — `file_refs` may carry `:line-range`, but T12's `focusFile` prop is `{path, line?: number}`; range parsing/degradation is unspecified. Also AC-14's "and the line if one is specified" branch is untested (T17 asserts file highlight only).
- **m3** — T9 keeps POST inside `useQuery`'s `queryFn`; refetch-on-window-focus will fire background POSTs. Harmless given server-side cache, but explicitly set `refetchOnWindowFocus`/staleness or note it — otherwise the LLM-call-count invariant depends on server behavior alone.
- **m4** — Spec's "No legacy left behind" vs. T1's "leave `Risks`/`PrHistory` untouched" if orphaned by the `PrBrief` deletion. Defensible (spec's removed-shapes list doesn't name them) but check whether they become dead exports and, if so, delete under the same authorization.
- **m5** — T5's "force skips the cache read but still takes the lock": under concurrency, a forced request queued behind a fresh generation performs a second LLM call immediately after the first. Correct per AC-8, but worth one line in T14 confirming this interplay isn't asserted the other way.
- **m6** — Whether `PrBriefCard` and `OverviewTab` both call `usePrBrief` (dedup via query key) or the data is lifted is left implicit across T10/T12; one sentence would prevent divergent implementer choices.

## What the plan gets right

Faithful, near-complete AC→task→test traceability (modulo M1); the grounding gate correctly kept pure and local (with the accurate note that `groundFindings()` needs hunks); `Brief.parse()` re-validation before caching as a trust boundary; lockstep edits to both vendored contract mirrors with the breaking changes explicitly flagged; the AC-11 metric-shape decision (per-review `ReviewRecord` over `PrMeta`) is well-reasoned; migrations are correctly scoped as pure add/drop with the rename-gate caveat; the failure contract (omit any failing fact source, never fatal) is carried into T5; and test tasks owning only `*.test.*` files is a clean non-overlap discipline.
