# Spec: Project Context Folder   |   Spec ID: SPEC-2026-07-07-project-context-folder   |   Status: draft
Supersedes: none

## Problem & why
DevDigest reviewers today are steered only by their system prompt and attached skills.
A repository's own specs and docs — the human-authored source of truth about how the code is
*supposed* to behave (architectural invariants, module boundaries, public-API contracts) —
never reach the reviewer. A reviewer therefore cannot catch a violation of a rule that is
written down in the repo but not in the agent's prompt.

reviewer-core already has an untrusted `## Project context` prompt slot (`PromptParts.specs`)
that is wired end to end but is fed nothing (`specs_read: []`, `specs: null` on every run).
This feature makes any markdown file from the repo's `specs`/`docs`/`insights` folders
*attachable* to review agents (and skills), so a spec stops being a "for humans only"
document and starts steering the reviewer — turning existing repo knowledge into review signal
with **zero new LLM calls**.

## Goals / Non-goals
- Goal: Discover, on a new "Project Context" screen, all `.md` files under folders named
  `specs`, `docs`, or `insights` (at any depth) in the repo clone, and show them with their paths.
- Goal: Let a user **manually** attach discovered documents to an agent (Agent editor →
  Context tab) and to a skill (Skill editor → Context tab), as an **ordered** set.
- Goal: An agent using a skill **inherits** that skill's attached documents.
- Goal: Store document **paths** (not text) in agent/skill metadata; resolve → read → inject at
  run time into the existing untrusted `## Project context` prompt slot.
- Goal: Make the injection **observable** in the run trace — which document paths were injected
  and their token volume — never guessed.
- Goal: Show a per-document token estimate and a "used by N agents" count, using the existing
  deterministic token estimator (chars/4). No LLM call.

- Non-goal: **Auto-selection of specs per PR** (the "flash-selector"). Attach is manual only.
  This is the headline deferral and must not creep in.
- Non-goal: Indexing / chunking / embedding of documents (the mock's "Indexed: 12 files ·
  1,240 chunks" footer and any vector search). Discovery lists files; it does not chunk them.
- Non-goal: Creating, uploading, or deleting repo document files from the app (the mock's
  `+` / upload toolbar). **Editing the content of an already-discovered `.md` document from
  the Project Context page is in scope** (AC-28..AC-32); creating new files, uploading, and
  deleting remain out of scope. (Amendment 2026-07-07 — see Decisions.)
- Non-goal: A "coverage ring" or any computed coverage/quality metric over documents.
- Non-goal: Any change to reviewer-core (the `specs` slot, wrapping, and grounding already exist).
- Non-goal: Reading `.md` files outside the configured root folders, or non-`.md` files.
- Non-goal: Baking document text into agent/skill config at edit time (paths only).

## User stories
- As a reviewer author, I want to browse every `specs`/`docs`/`insights` markdown file in my
  repo on one screen, so that I can see what context is available to attach.
- As a reviewer author, I want to attach specific documents to an agent in a defined order, so
  that the reviewer reads my project's rules before judging a diff.
- As a reviewer author, I want to attach documents to a skill, so that every agent using that
  skill inherits the same context without re-attaching per agent.
- As a reviewer author, I want to attach or detach a document to/from agents and skills directly
  from the Project Context page (not only from the editor tabs), so that I can wire up context
  from wherever I am browsing documents.
- As a reviewer author, I want to preview a document and see its token cost — on the Project
  Context page and on the editor tabs — before attaching, so that I understand what I am adding
  to the prompt budget.
- As a reviewer author, I want the run trace to show exactly which documents were injected and
  how many tokens they added, so that I can trust and debug the reviewer's context.
- As a reviewer author, I want to open the run's prompt-assembly view and read the full injected
  Project-context text, so that I can see verbatim what was sent to the model.
- As a reviewer author, I want a reviewer with an attached invariant spec to catch and quote a
  PR that violates it, so that written rules become enforced rules.
- As a reviewer author, I want to edit a discovered document's content from the Project Context
  page via a Preview/Edit toggle, so that I can correct or refine a spec without leaving the app.
- As a reviewer author, I want the Preview action on an Agent/Skill Context tab to open a
  readable preview of the document, so that I can check a document's content before attaching it.

## Inputs (provenance)
- Discovered document list (paths, parent path, folder-kind badge, byte size)
  — [deterministic: repo-intel] recursive filesystem scan of the repo clone; **no file contents read**.
- Per-document / per-block token estimate — [reused: existing tokenizer `approxTokens` = ceil(chars/4)].
- Attached document paths per agent and per skill — [deterministic: user-configured metadata]
  persisted as ordered path lists (no LLM, no text baked in).
- Document contents at run time — [reused: repo clone files, read via the existing git/clone
  read boundary]; injected as resolved strings into reviewer-core's `specs` slot.
- Prompt injection of those strings — [reused: reviewer-core `## Project context` slot +
  `wrapUntrusted` + `INJECTION_GUARD`].
- Edited document content on save — [deterministic: user-authored text] written back to the
  existing clone file at a confined path; re-read on the next Preview/run. No LLM.
- **Zero new LLM calls anywhere in this feature.** (No `[new: … LLM call]` inputs exist.)

## Acceptance criteria (EARS)

### Discovery
- AC-1: WHEN a user opens the Project Context screen for a repo, the system **shall** list every
  file matching `**/{specs,docs,insights}/**/*.md` (root folder names from server config) found in
  that repo's clone, each with its repo-relative path, parent path, and a `specs`/`docs`/`insights`
  folder-kind badge derived from its nearest matching ancestor folder.
  _(observable: discovered list on the screen matches a manual `find` over the clone; a `.md`
  outside those folders and a non-`.md` inside them are both absent.)_
- AC-2: The system **shall** compute the discovered list from filesystem metadata only (path +
  byte size), without reading any file's contents during discovery.
  _(observable: discovery performs stat-only I/O; no document body is loaded until Preview or a run.)_
- AC-3: IF the repo clone is missing, empty of matching files, or not yet synced, THEN the system
  **shall** return an empty document list and the screen **shall** render an explicit empty state
  (not an error), recording the reason.
  _(observable: a workspace with an unsynced repo shows the empty state with a "not indexed / no
  documents" message.)_
- AC-4: WHERE the discovered set exceeds the configured maximum (default 500 files), the system
  **shall** return the capped set and signal that the list was truncated.
  _(observable: a synthetic clone with >500 matching files returns exactly the cap plus a truncation flag.)_

### Attach (agent & skill)
- AC-5: WHEN a user attaches or reorders documents on an agent's Context tab, the system **shall**
  persist the selection as an **ordered** list of document paths for that agent, scoped to the
  workspace, and the order **shall** survive reload.
  _(observable: GET after PUT returns the same paths in the same order.)_
- AC-6: WHEN a user attaches or reorders documents on a skill's Context tab, the system **shall**
  persist the selection as an ordered list of document paths for that skill.
  _(observable: GET after PUT returns the same skill paths in order.)_
- AC-7: The system **shall** persist only document **paths** in agent/skill metadata and **shall
  not** store document text at attach time.
  _(observable: the stored attachment record contains paths, no bodies; editing a repo doc later
  changes what a run injects without any re-attach.)_
- AC-8: IF a client submits a document path that is not a `.md` file under a configured root
  folder, or that escapes the repo clone root (`..`, absolute path, or a symlink resolving outside
  the clone), THEN the system **shall** reject the attach request and persist nothing.
  _(observable: attaching `../../etc/passwd`, `/etc/hosts`, or `src/app.ts` returns a validation
  error; the attachment set is unchanged.)_
- AC-9: The system **shall** report, per discovered document, how many agents currently attach it
  (directly), so the screen can show a "used by N agents" count.
  _(observable: attaching a doc to 2 agents makes its count read 2.)_
- AC-24: WHEN a user attaches or detaches a document to/from an agent or a skill from the Project
  Context page (via an attach control on the selected document's pane that lists the workspace's
  agents and skills with checkboxes), the system **shall** apply the change through the **same**
  attachment write path used by the editor Context tabs, and the change **shall** be reflected on
  both the page and the corresponding editor tab.
  _(observable: checking an agent on the page adds the current document to that agent's ordered
  attachment set — verifiable via the agent's Context tab and the "used by N agents" count — and
  unchecking removes it; new attachments append to the end of the existing order.)_

### Injection at run time
- AC-10: WHEN an agent run executes, the system **shall** assemble the run's Project-context
  document set as the agent's directly-attached documents (in their order) followed by the
  documents inherited from each of the agent's enabled linked skills (in skill order then document
  order), **de-duplicated by normalized path keeping the first occurrence**.
  _(observable: a doc attached to both the agent and a linked skill appears once, at its
  agent-order position.)_
- AC-11: WHEN the assembled document set is non-empty, the system **shall** read each document from
  the PR's repo clone and pass the contents as resolved strings into reviewer-core's `specs` input,
  which renders them under `## Project context`, each `wrapUntrusted`-delimited, with the injection
  guard active.
  _(observable: the run's `prompt_assembly.specs` contains the document contents wrapped in
  `<untrusted source="spec-N">` blocks; `prompt_assembly.system` includes the injection guard.)_
- AC-12: IF an attached document is missing at run time (deleted, folder renamed, path belongs to a
  different repo than the PR), THEN the system **shall** skip that document, record the skip in the
  run log/trace, and continue the run without failing it.
  _(observable: deleting an attached file before a run yields a completed run whose trace notes the
  skipped path and omits it from `specs_read`.)_
- AC-13: IF resolving an attached path at run time escapes the repo clone root or resolves through a
  symlink outside it, THEN the system **shall** refuse to read it, skip it, and record the refusal
  (defense in depth, independent of AC-8).
  _(observable: a symlink under `docs/` pointing outside the clone is not read; the trace records
  the refusal.)_
- AC-14: WHERE an attached document exceeds the per-document character cap (default 20,000 chars),
  the system **shall** truncate it with an explicit truncation marker before injection and record
  that it was truncated.
  _(observable: a 1 MB doc is injected truncated to the cap; the trace notes truncation.)_
- AC-15: WHERE the assembled Project-context block would exceed the total budget (default 40,000
  chars), the system **shall** include documents in assembled order until the budget is reached,
  drop the remainder, and record which paths were dropped.
  _(observable: attaching many large docs injects a prefix within budget; dropped paths are logged.)_
- AC-16: The system **shall** cause a review to catch a violation of an attached spec: WHEN a
  reviewer has an attached document stating an invariant (e.g. "the `api/` module must not import
  `db/` directly") and reviews a PR that violates it, the reviewer **shall** be able to produce a
  finding referencing that rule.
  _(observable: the live-verification scenario — violating PR → finding that quotes/paraphrases the
  attached spec's rule.)_

### Run visibility
- AC-17: WHEN a run injects one or more documents, the system **shall** populate the run trace's
  `specs_read` with the injected document paths (post de-dup, post skip) and the trace **shall**
  expose the Project-context block's total token volume via the existing token estimator.
  _(observable: the run-trace drawer's "Specs read" row lists the injected paths; a token figure is
  shown, computed from `prompt_assembly.specs`, not from an LLM.)_
- AC-18: IF a run injects no documents (none attached, or all skipped), THEN `specs_read` **shall**
  be an empty array and no `## Project context` block **shall** appear in the assembled prompt
  (behavior identical to today).
  _(observable: an agent with no attached docs produces a trace with `specs_read: []` and
  `prompt_assembly.specs: null`.)_
- AC-25: WHEN a user opens a run's Prompt assembly view and the run injected documents, the section
  **shall** show a "Project context — attached specs (untrusted)" block that can be expanded to read
  the **full** injected text, rendered from the persisted `prompt_assembly.specs` (which already
  carries the complete assembled, `wrapUntrusted`-delimited block — no new trace field required). The
  block **shall** be shown as inert preformatted/plain text (not rendered as HTML/markdown), so the
  untrusted content cannot execute in the drawer.
  _(observable: expanding the block in the run-trace drawer shows the verbatim `<untrusted source="spec-N">…`
  text that was sent to the model, matching `prompt_assembly.specs`, with no script execution.)_

### UI
- AC-19: The Project Context nav item **shall** appear under WORKSPACE in the sidebar, between
  "Onboarding Tour" and the SKILLS LAB section, and its screen **shall** show, for a selected
  document, its name, a rendered markdown Preview, and a "used by N agents" badge.
  _(observable: navigating to the item renders the two-pane screen described.)_
- AC-26: The Project Context page **shall** display, for each discovered document, an estimated
  token count computed from the document's size via the existing estimator (ceil(chars/4)) — so the
  user sees how many tokens a document adds to a prompt without any LLM call.
  _(observable: each document row/pane shows "≈ N tokens" equal to ceil(size_bytes/4); no model is
  called to produce it.)_
- AC-20: The Agent and Skill Context tabs **shall** present each candidate document as a row with a
  drag handle, an attach checkbox, filename, parent path, a folder-kind badge, and a Preview
  action, plus a "Filter documents…" search, styled consistently with the existing Skills tab.
  The Preview action's behavior is specified in AC-27.
  _(observable: the Context tab matches the Skills-tab interaction pattern; search filters the list.)_
- AC-27: WHEN a user activates a document row's Preview action on an Agent or Skill Context tab,
  the system **shall** open a preview drawer/panel that displays the document's filename and its
  parent path, a close (dismiss) control, and the document's content rendered as **sanitized**
  markdown (AC-21 applies — identical rendering to the Project Context page's Preview, **not**
  inert plain text); WHEN the user activates Preview on a different row, the drawer **shall**
  switch to that document; WHEN the user activates the close control (or re-activates the same
  row's Preview), the drawer **shall** be dismissed.
  _(observable: clicking Preview on `onboarding.system.md` from the General Reviewer agent's
  Context tab opens a drawer titled with that filename and its parent path (`server/src/prompts`)
  showing sanitized rendered markdown; a doc containing `<script>` or a `javascript:` link renders
  inert; clicking another row swaps the drawer content; the close control hides the drawer.)_
- AC-21: The system **shall** render every document Preview as **sanitized** markdown — no raw
  embedded HTML/script execution and no `javascript:` URLs — because document content is
  repo-controlled untrusted text.
  _(observable: a doc containing `<script>` or a `javascript:` link renders inert, not executed.)_
- AC-22: WHEN a Context tab shows attached documents, the system **shall** display an estimated
  token total for the current selection and a note that the selection is injected as an untrusted
  `## Project context` block.
  _(observable: the footer shows "≈ N tokens" matching the estimator and the untrusted-block note.)_
- AC-23: WHERE a skill has attached documents, the Skill editor Context tab **shall** show a
  read-only "SERIALIZES AS" preview of the block the skill contributes — a `## Project context`
  heading followed by the ordered attached document paths as a bullet list (e.g. `- specs/public-api.md`)
  — computed entirely client-side from the attached selection (no backend change).
  _(observable: attaching `specs/public-api.md` to a skill renders a "SERIALIZES AS" block listing
  that path under a `## Project context` heading; it updates as the selection changes.)_

### Editing (Project Context page)
- AC-28: WHERE a document is selected on the Project Context page, the document pane **shall**
  present a **Preview / Edit** toggle: Preview renders the content as sanitized markdown (AC-21),
  and Edit presents the current content in a plain-text editor. Edit mode is offered **only on
  the Project Context page**, not in the Agent/Skill Context-tab preview drawer (AC-27 stays
  preview-only).
  _(observable: the document header shows two toggle tabs; switching to Edit replaces the rendered
  preview with an editable plain-text area, switching back to Preview restores the rendered view;
  the Context-tab drawer shows no Edit affordance.)_
- AC-29: WHEN the user switches a selected document to Edit, the system **shall** load that
  document's current content — read through the **same** confined read boundary as Preview
  (AC-8) — into the editor.
  _(observable: opening Edit shows the exact current file text, matching the Preview source.)_
- AC-30: WHEN the user saves an edited document, the system **shall** write the submitted content
  to that document's path only after confining the path with the **same** rules as AC-8/AC-13 —
  `.md` extension, under a configured root folder, no `..`/absolute path, and the resolved real
  path (symlinks included) inside the clone root — and **shall** reject the save and write nothing
  to disk otherwise.
  _(observable: saving a valid `specs/foo.md` updates the file on disk; a save targeting
  `../../etc/passwd`, `/etc/hosts`, `src/app.ts`, or a symlink escaping the clone is rejected with
  a validation error and no file is written.)_
- AC-31: WHEN a save succeeds, the system **shall** make the saved content the new source of truth
  for that document, read back on subsequent access **until the next repo resync**: the pane's
  Preview, the document's token estimate and byte size (recomputed from the new content), and any
  subsequent run's injected content for that path **shall** reflect the saved text — because
  attachments store paths only and both Preview and run-time injection re-read the file (AC-7,
  AC-11). The edit is **clone-local and ephemeral**: the next `git.sync()` (`git fetch` +
  `git reset --hard origin/<branch>`) restores the upstream file and discards the edit; this
  resync behavior is **accepted, not a bug** (see Decisions).
  _(observable: after saving, re-opening Preview shows the new text, the "≈ N tokens" and size
  update, and a run that injects that path injects the edited content — no re-attach needed; after
  a repo resync the same path reads back the upstream content.)_
- AC-32: IF the repo clone is missing, or the target file cannot be written (unwritable / I/O
  error), or the path fails confinement (AC-30), THEN the system **shall** reject the save with an
  explicit error and leave the existing on-disk file unchanged (no partial write).
  _(observable: a save against a workspace with no clone, or an unwritable file, returns an error;
  the previous file content is intact.)_
- AC-33: WHILE the Project Context page document pane is in Edit mode, the system **shall** display
  an explicit warning that edits are local to the review clone and may be overwritten on the next
  sync, so the user understands the edit is ephemeral (AC-31).
  _(observable: switching a document to Edit shows a visible notice such as "Edits are local to the
  review clone and may be overwritten on the next sync"; Preview mode does not show it.)_

## Edge cases
- Empty discovery result (no matching folders/files) → AC-3 (empty state, no error).
- Repo clone missing / not yet synced / stale → AC-3 (empty/degraded, reason recorded); at run
  time reads reflect the last-synced clone → AC-12 covers missing individual files.
- Oversized discovery result (thousands of docs) → AC-4 (capped + truncation flag).
- Attached file deleted or folder renamed before a run → AC-12 (skip + log, run still completes).
- Path traversal / absolute path / symlink escaping the clone at attach time → AC-8 (reject).
- Path traversal / symlink escaping the clone at run time → AC-13 (refuse + skip; defense in depth).
- Huge single document → AC-14 (per-doc truncation).
- Many/large documents blow the prompt budget → AC-15 (budget cap, drop remainder, log).
- Duplicate attachment via both an agent and one of its skills → AC-10 (de-dup by path, first wins).
- Attached document belongs to a repo other than the PR's repo (multi-repo workspace) → resolves
  as missing against the PR clone → AC-12 (skip + log). See Decisions (single-repo scan).
- Concurrent runs reading the same documents → read-only filesystem access, safe → accepted: no
  special handling.
- A skill is disabled or flagged injection-detected → its inherited documents are excluded, mirroring
  the existing skill-body gate → covered by AC-10 ("enabled linked skills").
- Document with non-UTF-8 / unreadable content at run time → treated as an unreadable file →
  AC-12 (skip + log).
- Save targeting a path that fails confinement / non-`.md` / outside root folders / symlink
  escape → AC-30 (reject, nothing written; same guard as attach).
- Save when the clone is missing or the target file is unwritable → AC-32 (reject, file unchanged).
- Edited document clobbered by a repo resync: `git.sync()` runs `git fetch` + `git reset --hard
  origin/<branch>` (`server/src/adapters/git/simple-git.ts:102`), which discards any local
  worktree edit to a tracked file. A saved edit is therefore **clone-local and lives only until
  the next resync of that repo**, after which the upstream content returns. At run time the run
  reads whatever the clone currently holds (edited or resynced) → AC-11/AC-31. This is the
  **accepted, chosen behavior** (ephemeral, option (a)); the Edit UI warns about it → AC-33.
  Not a bug → accepted: no additional handling.

## Non-functional
- Security (path confinement, A01/A05): attached paths **and the edit/save path** are
  attacker-influenceable input. Every read — discovery, Preview, and run-time injection — **and
  the save write (AC-30)** **shall** confine to the repo clone root: allow only `.md` files under
  a configured root folder, reject `..`/absolute paths, and validate the resolved real path
  (symlinks included) stays within the clone dir. Enforced at attach time (AC-8), at read/run time
  (AC-13), and before any write on save (AC-30). No path escaping the clone is ever read **or
  written**.
- Security (write surface, A01/A08 — new in this amendment): the save endpoint (AC-30) is the
  feature's only mutation of on-disk repo files. It **shall** be workspace-scoped (writes only
  within the requesting workspace's repo clone, resolved server-side like discovery/preview — not
  from a client-supplied absolute path), reject non-confined paths before writing, and never
  partially write on failure (AC-32). It grants no new prompt trust: edited content re-enters a
  run through the same `wrapUntrusted` boundary as any repo file (AC-11).
- Security (untrusted content): document text is repo-controlled and **shall** be treated as data,
  never instructions — wrapped by `wrapUntrusted` under the injection guard in the prompt (AC-11),
  and sanitized before browser Preview (AC-21).
- Performance: discovery is stat-only and **shall** complete within p95 < 2s for a typical repo
  (≤ 500 matched files, AC-2/AC-4). Run-time document reads are best-effort and **shall never** fail
  a run (AC-12/AC-13) — mirroring the existing "context enrichment is best-effort" rule.
- Budget: per-document cap default 20,000 chars (AC-14); total Project-context block cap default
  40,000 chars (AC-15). Both configurable server-side.
- Accessibility: the new screen and Context tabs **shall** meet WCAG 2.1 AA — icon-only buttons
  (drag handle, Preview, refresh) carry `aria-label`s, the document filter exposes results via
  `aria-live`, and reorder is operable at least to the parity of the existing Skills tab.
- Success signal: a reviewer with an attached invariant spec produces a finding that references
  that spec's rule on a violating PR (AC-16), and the run trace's `specs_read` shows the spec was
  injected (AC-17) — written repo rules become enforced, observable review signal.

## Cross-module interactions
- **client → server (discovery/attach):** the Project Context screen **and** the Agent/Skill Context
  tabs call server endpoints to list discovered documents, read/write an agent's or skill's ordered
  attachment list, fetch a document Preview, and read the "used by N agents" count. The Project Context
  page's attach/detach control (AC-24) reuses the **same** agent/skill attachment write endpoints as
  the editor tabs — no new endpoint. Failure contract: discovery degrades to an empty list with a
  reason (AC-3); a bad attach path is rejected (AC-8).
- **client → server (edit/save):** the Project Context page's Edit mode calls a **new** server
  endpoint to write a confined document's content back to the clone worktree file (AC-30). This is
  the only write endpoint in the feature. Failure contract: confinement failure, missing clone, or
  an unwritable file → the save is rejected and nothing is written (AC-30/AC-32). The read used to
  populate the editor reuses the existing Preview read boundary (AC-29). The edit is clone-local and
  ephemeral — the next `git.sync()` (`reset --hard`) discards it (accepted; AC-31/AC-33).
- **server (run-executor) → repo clone → reviewer-core:** at run time the executor assembles the
  agent+skill document set (AC-10), reads each from the PR's repo clone through the existing git/clone
  read boundary (AC-11), applies the caps (AC-14/AC-15), and passes resolved strings into
  reviewer-core's `specs` input — mirroring how linked-skill bodies are resolved and passed today.
  Failure contract: any unreadable/unsafe/oversize document is skipped or truncated, never fatal
  (AC-12/AC-13/AC-14/AC-15). reviewer-core is unchanged.
- **server → run trace (client):** the executor populates `specs_read` (paths) and `prompt_assembly.specs`
  (the **full** assembled, delimiter-wrapped block text). The run-trace drawer surfaces both — the
  "Specs read" row (paths + token total) and an expandable "Project context — attached specs
  (untrusted)" block showing the full injected text (AC-17/AC-18/AC-25). No new trace field is
  required: `prompt_assembly.specs` already carries the complete text in the existing contract.
- **Shared contract note:** contract shapes that cross the client/server boundary must be kept in
  the two hand-synced vendored copies of the shared contracts.

```mermaid
sequenceDiagram
    participant RE as run-executor (server)
    participant DB as agent/skill attachments
    participant Clone as repo clone (fs, per PR repo)
    participant RC as reviewer-core (pure)
    RE->>DB: read agent docs + enabled-skill docs (ordered)
    RE->>RE: merge + de-dup by path (agent first, then skills)
    loop each attached path
        RE->>Clone: confine to clone root, read .md (best-effort)
        alt missing / unsafe / oversize
            RE->>RE: skip or truncate + record in trace
        else ok
            RE->>RE: collect content (within budget)
        end
    end
    RE->>RC: reviewPullRequest({ specs: [resolved strings], … })
    RC->>RC: wrapUntrusted each → "## Project context" + injection guard
    RC-->>RE: grounded Review
    RE->>RE: trace.specs_read = injected paths; token volume from prompt_assembly.specs
```

## Contracts
Shapes only (fields + direction + optionality); serialization lives in the vendored shared contracts.

**Discovered document** (server → client):
| field | type | notes |
|-------|------|-------|
| path | string | repo-relative, POSIX-style |
| parent_path | string | directory portion, for display |
| name | string | filename |
| folder_kind | enum `specs` \| `docs` \| `insights` | from nearest matching ancestor folder |
| size_bytes | number | from stat (discovery reads no content) |
| est_tokens | number | ceil(size or char count / 4) — deterministic estimate |
| used_by_agents | number | count of agents directly attaching this path |

**Discovery response** (server → client): `{ documents: DiscoveredDocument[], truncated: boolean, reason?: string }`
(`reason` present when the list is empty/degraded — AC-3.)

**Agent/skill attachment** (client ↔ server): an **ordered list of document paths** owned by an
agent, and separately by a skill, workspace-scoped. Read returns the ordered paths (optionally
enriched with the DiscoveredDocument fields for display); write replaces the set with a new ordered
list. Persistence follows the existing `agent_skills(owner_id, ref, order)` join-table shape, with
the document identified by its **path string** (documents are repo files, not DB entities with ids):
one join relation for agent↔document, one for skill↔document, each carrying an `order` index.

**Document preview** (server → client): `{ path, content }` where `content` is the raw markdown of a
validated path (rendered client-side, sanitized — AC-21). Rejects any path failing confinement (AC-8).

**Document save** (client → server, new): request `{ path: string, content: string, repoId?: string }`;
response echoes the saved document as `{ path: string, content: string }` (the `DocumentPreview` shape,
so the pane can re-render immediately). The `path` is confined identically to AC-8/AC-13 before any
write (AC-30); the request is rejected (nothing written) on confinement failure, a missing clone, or an
unwritable file (AC-32). `repoId` scopes the write to a specific repo like preview. Lives in the
vendored shared contracts alongside `DocumentPreview`.

**Run trace** (server → client, existing `RunTrace`): `specs_read: string[]` populated with injected
paths (AC-17); `prompt_assembly.specs` carries the **full** rendered untrusted block text — the
complete, delimiter-wrapped Project-context that was sent to the model — which the drawer exposes
expandably (AC-25). Both fields already exist in the vendored `RunTrace` contract, so **no new trace
field is required** for MVP; a per-document token breakdown remains out of scope (a [PROPOSAL]).

## Untrusted inputs
Yes. Untrusted surfaces:
1. **Document contents injected into the prompt** — repo-controlled markdown. Treated as data via
   reviewer-core's existing `wrapUntrusted('spec-N', …)` under the `## Project context` heading with
   the `INJECTION_GUARD` system rule. No feature change needed here; the spec only requires the
   feature to route contents through that existing boundary (AC-11).
2. **Attached path strings** — attacker-influenceable. Confined to the repo clone root, `.md`-only,
   root-folder-only, symlink-resolved, at both attach and read time (AC-8/AC-13).
3. **Document markdown rendered in the browser Preview** — sanitized to prevent stored XSS (AC-21).
   This applies to **both** the Project Context page preview and the Agent/Skill Context-tab preview
   drawer (AC-27); neither renders raw HTML or `javascript:` URLs.
4. **Save request (path + content)** — attacker-influenceable. The **path** is confined identically
   to attach/read (AC-30). The **content** becomes the document body on disk; on a later run it
   re-enters the prompt through the same `wrapUntrusted` boundary as any repo file (AC-11) — editing
   grants no new prompt trust. The save endpoint is workspace-scoped and rejects out-of-confinement
   or unwritable targets (AC-30/AC-32).

## Assumptions
- Assumed the configurable root-folder set defaults to exactly `specs`, `docs`, `insights` (from the
  request) and lives in server config/constants alongside repo-intel constants — say so if wrong.
- Assumed documents are read from the **same repo clone the reviewer already uses** (the PR's repo,
  via the existing git/clone read boundary), so no new clone or fetch is introduced — say so if wrong.
- Assumed attachment order = injection order, with agent-attached documents before skill-inherited
  ones, de-duplicated first-occurrence-wins (AC-10) — say so if a different precedence is wanted.
- Assumed per-document (20,000 chars) and total-block (40,000 chars) caps are reasonable defaults,
  tunable via server config — say so if the budget should differ.
- Assumed discovery is stat-only and capped at 500 files by default (AC-2/AC-4) — say so if a
  different cap or eager content read is wanted.
- Assumed a re-scan/refresh of the discovered list (re-reading the clone) is in scope as a cheap
  read-only action; creating/uploading/editing docs is not (Non-goals).
- Assumed disabled or injection-flagged skills do not contribute inherited documents, mirroring the
  existing skill-body gate — say so if wrong.
- Assumed in-app editing (AC-28..AC-32) targets an **already-discovered** `.md` document and writes
  directly to that file in the repo clone worktree — no new-file creation, upload, or deletion — say
  so if wrong.
- Assumed Edit mode appears **only on the Project Context page** document pane, not in the
  Agent/Skill Context-tab preview drawer, which stays preview-only (AC-27) — say so if the Context
  tabs should also be editable.
- **Decided (not an assumption): a saved edit is clone-local and ephemeral** — written to the clone
  worktree, read back on the next Preview/run, and discarded by the next repo resync (option (a),
  see Decisions). The Edit UI warns about this (AC-33).
- Assumed Context-tab Preview (AC-27) renders **sanitized markdown** exactly like the Project Context
  page (reusing the same safe-markdown renderer), replacing the current plain-text `<pre>` rendering
  — say so if plain text was intended there.

## Proposals (out of scope)
- [PROPOSAL: a per-path token breakdown in the run trace (each injected doc with its own token
  count), beyond the block-level total — richer cost attribution, needs a small `RunTrace` field.]
- [PROPOSAL: fully keyboard-accessible drag reorder on Context tabs if the existing Skills-tab DnD
  is mouse-only — an a11y upgrade that would also lift the Skills tab.]
- [PROPOSAL: a "used by N skills" count alongside "used by N agents", so authors see indirect usage.]
- [PROPOSAL: warn in the Agent editor when an attached document no longer exists in the current
  clone (a "stale attachment" badge), instead of only discovering the skip at run time.]

## Open questions
- None open. All prior clarifications are resolved and recorded as decisions (see Decisions).

## Decisions (resolved clarifications)
- **Multi-repo scoping → single-repo scan.** The Project Context screen scans the workspace's repo
  clone; attached paths resolve at run time against the **PR's** repo clone, and mismatches are
  skipped (AC-12 unchanged). A union/selector across multiple repos is out of scope for this lesson.
- **Run-trace granularity → block-level total only.** `specs_read` (paths) plus the block-level token
  total (AC-17) is the shipped observability; a per-document token breakdown stays out of scope
  (retained as a [PROPOSAL]).
- **Budget caps → confirmed.** Per-document cap 20,000 chars (AC-14) and total Project-context block
  cap 40,000 chars (AC-15), both truncate-and-log and server-config-tunable.
- **Editing scope revisited on 2026-07-07 (Amendment 1).** The original Non-goal "editing … repo
  document files" is **narrowed**: editing an already-discovered `.md` document's content from the
  Project Context page is now in scope (AC-28..AC-32); creating, uploading, and deleting remain out
  of scope. Grounding: `GitClient` exposes `readFile` but no write, so a confined write path is new;
  `guardPath` (`server/src/modules/project-context/path-guard.ts`) already enforces the exact
  confinement the save needs and requires the target to already exist — matching "edit an existing
  discovered doc".
- **Edit persistence resolved on 2026-07-07 → option (a), clone-local ephemeral.** A saved edit is
  written directly to the clone worktree file and lives only until the next `git.sync()`
  (`git fetch` + `git reset --hard origin/<branch>`, `server/src/adapters/git/simple-git.ts:102`),
  which restores the upstream content. This resync-clobber is **accepted, not a bug** (AC-31), and
  the Edit UI shows an explicit ephemerality warning (AC-33). Rejected alternatives:
    - **(b) DB persistence + re-apply after sync** — durable without touching git, but adds new
      storage and apply-on-sync orchestration; unnecessary weight for this lesson.
    - **(c) commit/push to the repo** — never requested; also a `reset --hard` would still discard a
      local-only commit that is not on origin, so it would not actually survive resync without a real
      push, expanding scope into git write access we deliberately avoid.
- **Context-tab Preview behavior clarified on 2026-07-07 (Amendment 2, AC-27).** AC-20 left the row
  Preview action's result unspecified. AC-27 now requires it to open a dismissible drawer showing the
  document name, parent path, and **sanitized rendered markdown** (AC-21) — resolving the observed
  implementation discrepancy where Context-tab previews render **plain text** in a `<pre>`
  (`client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx:291`;
  same in the skills ContextTab) while the Project Context page renders sanitized markdown via
  `SafeMarkdown` (`client/src/app/project-context/_components/ProjectContextView.tsx:416`). AC-27
  makes the two consistent. Edit mode (AC-28) is deliberately **not** added to this drawer — Project
  Context page only.
