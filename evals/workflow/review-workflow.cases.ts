import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 8 Claude sessions total.
 *   - 6 × trace     → 1 session each                      = 6
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 * A `trace` case may also carry judged `practices` (scored on result.text, not just the trace) —
 * used below for the db:generate rename gate, where the assertion is about what the model
 * *recommends*, not merely which file it opened.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): CLAUDE.md "Read When" routing + subagent dispatch, together -----------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    // `server/docs/api-contracts.md` never existed in this repo (verified via `git log`) — same
    // stale-target bug as the pipeline case above. server/AGENTS.md's own "Use when" table routes
    // "route/API map" questions to `server/README.md`, which has a real "API map" section with
    // every route. Every prior run's trace shows the model correctly reading server/README.md and
    // getting scored as a failure anyway because the assertion pointed at a file that never existed.
    name: "API-route task reads api-contracts AND pulls the architecture-reviewer",
    // Traced (not guessed): two baseline runs both dispatched architecture-reviewer cleanly with a
    // full design — no clarifying-question dead end. The actual fork is HOW the model checks
    // conventions: one run read server/README.md, the other went straight to the source files
    // (routes.ts/service.ts/repository.ts) and skipped the README. Both are legitimate ways to
    // "check conventions"; asserting one specific doc path was stricter than the prompt's real
    // "MUST" (dispatch the subagent), so that's the only thing checked here now.
    prompt:
      "I'm planning to add a NEW, not-yet-implemented endpoint GET /reviews/:id/export (returns the " +
      "review as markdown). The export should contain the review's findings and metadata, rendered " +
      "as a markdown string returned in the JSON body. First check this repo's API conventions. Then " +
      "you MUST dispatch the architecture-reviewer subagent to evaluate my plan against the onion " +
      "layers — do not review it yourself. Do not ask me for more design details; dispatch the " +
      "subagent with your best plan.",
    expectSubagents: ["architecture-reviewer"],
    // Was 8; two baseline runs both landed at 9 turns and got cut off one step from finishing
    // (see docs/retros — maxTurns exhaustion flips result.isError, which fails the case outright
    // regardless of how close the trace was to satisfying the expectations).
    maxTurns: 10,
  },

  // --- trace (1 session): two "Read When" rows at once -----------------------------------------
  {
    kind: "trace",
    // Tests the CLAUDE.md "Read When" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("figure out how this all works") sent the model straight
    // into schema.ts / pipeline.run.ts and it never opened the routed doc. One anchor doc keeps this
    // a deterministic routing check — asserting two docs in one session is inherently flaky.
    // `reviewer-core/docs/pipeline.md` never existed in this repo (verified via `git log`) —
    // reviewer-core/AGENTS.md's own "Use when" table actually routes pipeline questions to
    // `reviewer-core/README.md` (which has the real pipeline diagram); docs/ is for deep-dives and
    // is empty. The old expectation could never pass.
    // "review pipeline" alone spans reviewer-core logic, server API, and prompt templates — a
    // model would sometimes stop to ask which one instead of reading anything. Naming reviewer-core's
    // own diff->LLM->findings pipeline removes that ambiguity without hand-holding the doc lookup.
    name: "pipeline task follows CLAUDE.md routing to pipeline.md",
    prompt:
      "I'm about to change the review pipeline logic in reviewer-core (the diff → prompt → LLM → " +
      "grounded findings process itself, not the server API and not individual prompt templates). " +
      "Before touching any code — check this repo's guidelines (CLAUDE.md) for which documentation " +
      "to read for pipeline changes, and read exactly those documents.",
    expectFilesRead: ["reviewer-core/README.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): CLAUDE.md "Hit unexpected behavior" routing -> gotchas ----------------
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path and read INSIGHTS.md, making the negative flaky. As a single-session trace it
  // reliably checks the same routing rule: in the real repo, the discovery prompt reads INSIGHTS.md.
  {
    kind: "trace",
    name: "CLAUDE.md routes a gotchas lookup to reviewer-core/INSIGHTS.md",
    prompt:
      "In reviewer-core I ran into unexpected behavior — something isn't working the way I expected. " +
      "Per this repo's guidelines, where might this already be documented? Read that file.",
    expectFilesRead: ["reviewer-core/INSIGHTS.md"],
    maxTurns: 5,
  },

  // --- trace (1 session): "Use when" routing to a package's own AGENTS.md -----------------------
  {
    kind: "trace",
    name: "client-side task reads client/AGENTS.md",
    prompt:
      "I'm about to add a new React component in client/. Before writing any code, follow this " +
      "repo's guidelines for working inside a package — read the relevant guide.",
    expectFilesRead: ["client/AGENTS.md"],
    maxTurns: 6,
  },

  // --- trace (1 session): root CLAUDE.md "Session protocol" — read package INSIGHTS.md first ----
  // server/INSIGHTS.md has 30+ real entries (unlike thinner packages), so a genuine "read and
  // summarize" is checkable — an empty/near-empty INSIGHTS.md would make this un-failable.
  {
    kind: "trace",
    name: "session protocol reads server/INSIGHTS.md before touching the package",
    prompt:
      "I'm about to work on rate limiting in server. Before changing anything, follow this " +
      "repository's protocol (CLAUDE.md) for starting a session in a package — and summarize what you learned from it.",
    expectFilesRead: ["server/INSIGHTS.md"],
    maxTurns: 6,
  },

  // --- trace + judged practices (1 session): server/CLAUDE.md's db:generate rename gate ---------
  // The documented landmine: `db:generate` opens an interactive TTY prompt on a rename and hangs
  // in non-TTY environments (CI). Reading server/CLAUDE.md isn't enough evidence on its own — the
  // real assertion is whether the model's ANSWER steers away from db:generate for a rename.
  // server/CLAUDE.md and server/AGENTS.md carry the byte-identical rename-gate sentence (grep
  // confirmed) — a run that read AGENTS.md instead gave the same correct answer but failed the
  // trace assertion outright before the judge ever ran. Either doc is evidence the guidance was
  // consulted, so this is an "any of" group, not a single required path.
  {
    kind: "trace",
    name: "column-rename question avoids recommending db:generate",
    prompt:
      "I renamed the `title` column to `name` in the `reviews` table schema in server. What should " +
      "I do next for the migration, per this repo's conventions?",
    expectFilesRead: [["server/CLAUDE.md", "server/AGENTS.md"]],
    // The first practice used to be phrased as a negation ("does not instruct running X"). The
    // judge's rubric only accepts PASS via a verbatim quote as evidence — asking it to prove an
    // ABSENCE via a quote is self-contradictory, since any quote near the topic necessarily
    // contains the forbidden term. Observed failure: a response that said "DO NOT run `npm run
    // db:generate`" got scored FAILED, with that exact sentence quoted as the (mis-scored)
    // evidence. Rephrasing as a positive assertion gives the judge an unambiguous PASS target.
    practices: [
      "explicitly tells the user to skip/avoid running `db:generate` (or `npm run db:generate`) for this rename, e.g. by saying 'do not run' or 'avoid' it",
      "instructs writing the migration SQL manually, e.g. an ALTER TABLE ... RENAME COLUMN statement, and updating meta/_journal.json",
    ],
    // Was 8; a baseline run landed at 9 turns and got cut off right before the Write call for the
    // migration file — same maxTurns-exhaustion failure mode as the API-route case above.
    maxTurns: 9,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    // SKILL.md's own "Where to write" table requires naming one of 4 packages before it can write
    // anywhere. A module-agnostic prompt left that ambiguous, and models split on WHEN they asked
    // for it — some called Skill first then asked, some asked in plain text without ever calling
    // Skill (the latter reads as "not activated"). Naming the module here removes that ambiguity —
    // it isolates the trigger-phrase question (does "gotcha" phrasing activate the skill?) from the
    // separate module-routing question the skill's body already handles.
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Just figured out in server why the pgvector query was returning zero rows — the column " +
      "dimension didn't match after changing the embedding model. I want to record this so I don't step on it again.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Explain how column dimensions work in pgvector and why a mismatch returns zero rows.",
    skill: "engineering-insights",
    shouldActivate: false,
    // Was 4, then 6 — both still got cut off (5 turns, then 7 turns) before producing the
    // explanation. Turn count for this case is more variable than expected; give it real headroom.
    maxTurns: 8,
  },
];
