# How to Create a Claude Code Plugin

A Claude Code **plugin** is a git repository that packages one or more **skills** — markdown files that extend the AI agent with specialised knowledge and workflows. Once published, any team can import your skills into their project with a single entry in `skills-lock.json`.

This guide is grounded in how DevDigest itself is structured. All examples refer to real files in this repo.

---

## 1. What Is a Claude Code Plugin?

```
my-plugin/               ← git repo root
├── plugin.json          ← manifest: name, version, skill list
├── marketplace.json     ← marketplace listing (optional, for publishing)
└── skills/
    └── my-skill/
        ├── SKILL.md     ← skill definition (required)
        ├── examples.md  ← concrete examples (recommended)
        └── references.md
```

- **`plugin.json`** (or `tile.json` — both are valid) declares the plugin identity and maps skill names to file paths.
- **`marketplace.json`** carries human-readable listing metadata used by the Claude Code marketplace. Omit it if the plugin is internal-only (`"private": true` in plugin.json).
- **Skills** are markdown files. The agent loads them on demand — they are not always active.

A repo can be a plugin and a working application at the same time. DevDigest skills live in `.claude/skills/` and the manifest at `plugin.json` points into that directory.

---

## 2. Plugin Anatomy

### `plugin.json`

```json
{
  "name": "author/plugin-name",
  "version": "1.0.0",
  "private": false,
  "summary": "One-paragraph description. Used as AI context when the agent loads the plugin.",
  "skills": {
    "skill-name": { "path": "relative/path/to/SKILL.md" }
  }
}
```

| Field     | Type      | Required  | Notes                                                                                              |
|-----------|-----------|-----------|----------------------------------------------------------------------------------------------------|
| `name`    | `string`  | yes       | GitHub-style `author/repo` identifier. Used as the import key in `skills-lock.json`.               |
| `version` | `string`  | yes       | Semver. Bump on any breaking change to a skill's behaviour.                                        |
| `private` | `boolean` | yes       | `true` = not for marketplace. Even private plugins can be imported by URL.                         |
| `summary` | `string`  | yes       | Loaded as AI context alongside the skill. Keep it to one paragraph; trigger terms improve routing. |
| `skills`  | `object`  | yes       | Map of `skillName → { path }`. Path is relative to the manifest file.                              |

Real example in this repo: [`plugin.json`](../plugin.json)
Schema reference: [`tile.json`](.claude/skills/fastify-best-practices/tile.json) (identical format, alternative filename)

### `marketplace.json`

```json
{
  "name": "Display Name",
  "description": "Longer description shown on the marketplace listing page.",
  "tags": ["tag1", "tag2"],
  "category": "development",
  "author": {
    "name": "Your Name",
    "github": "your-github-handle",
    "email": "you@example.com"
  },
  "repository": "https://github.com/author/repo",
  "license": "MIT",
  "minClaudeCodeVersion": "1.0.0"
}
```

`marketplace.json` is read-only metadata — it does not affect how the plugin behaves locally. It exists so the marketplace can render a listing without needing to parse `plugin.json` or individual skills.

Real example in this repo: [`marketplace.json`](../marketplace.json)

---

## 3. SKILL.md Format

Every skill starts with a YAML frontmatter block, then free-form markdown content.

```markdown
---
name: my-skill
description: "One-to-three sentence description used by the agent to decide when to load this skill. Include trigger terms (library names, task patterns, domain concepts)."
user-invocable: true
version: "1.0.0"
allowed-tools: Read, Edit, Bash
---

# My Skill

Content goes here.
```

### Frontmatter fields

| Field            | Required  | Notes                                                                                                                    |
|------------------|-----------|--------------------------------------------------------------------------------------------------------------------------|
| `name`           | yes       | Must match the key in `plugin.json`'s `skills` map.                                                                      |
| `description`    | yes       | This is what the agent reads to decide relevance. Be specific; include trigger terms.                                    |
| `user-invocable` | no        | `true` = user can invoke with `/my-skill`. Default: false.                                                               |
| `version`        | no        | Skill-level semver. Independent of the plugin version.                                                                   |
| `allowed-tools`  | no        | Comma-separated list of tools this skill is allowed to call (e.g. `Read, Edit, Bash`). Omit to inherit project defaults. |

### Content conventions

- Write in imperative mood ("Use X when Y", "Never do Z").
- Sections over prose: use `##` headings so the agent can locate rules without reading everything.
- Include a "When to load" or "Trigger" section so the agent knows when this skill applies.
- Keep the file focused — companion docs (`examples.md`, `references.md`, topic-specific `.md` files) are better than one 500-line SKILL.md.

Real examples to read:
- Simple skill: `.claude/skills/mermaid-diagram/SKILL.md`
- Complex skill with companion files: `.claude/skills/pr-self-review/SKILL.md`
- Skill with `allowed-tools`: `.claude/skills/drizzle-orm-patterns/SKILL.md`

---

## 4. Step-by-Step: Create a Skill

```bash
# 1. Create the skill directory
mkdir -p .claude/skills/my-skill

# 2. Write the skill definition
# → .claude/skills/my-skill/SKILL.md  (see format above)

# 3. Add examples (recommended)
# → .claude/skills/my-skill/examples.md

# 4. Register it in plugin.json
#    Add to the "skills" map:
#    "my-skill": { "path": ".claude/skills/my-skill/SKILL.md" }

# 5. Add it to the catalog
# → .claude/skills/README.md — add a row to the Catalog table

# 6. Test it
# Open Claude Code. If user-invocable: true, type /my-skill.
# Otherwise, describe a task that matches the skill's description and verify the agent loads it.
```

**Checklist before committing:**
- [ ] `name` in frontmatter matches the key in `plugin.json`
- [ ] `description` includes at least 3 trigger terms
- [ ] At least one concrete example in `examples.md` (or inline)
- [ ] Row added to `.claude/skills/README.md`
- [ ] `plugin.json` updated with the new skill path

---

## 5. Step-by-Step: Import a Skill from an External Plugin

Other teams import published plugins by adding an entry to `skills-lock.json` and running the install command.

### `skills-lock.json` entry format

```json
{
  "version": 1,
  "skills": {
    "my-skill": {
      "source": "github-user/repo-name",
      "sourceType": "github",
      "skillPath": "relative/path/in/that/repo/SKILL.md",
      "computedHash": "<sha256 of SKILL.md content>"
    }
  }
}
```

- `source` — GitHub `owner/repo` (public repos only for automated install)
- `skillPath` — path to the `SKILL.md` inside that repo (same as the `path` value in the plugin's `plugin.json`)
- `computedHash` — SHA-256 of the skill file content; used to detect tampering or drift

Real examples: see [`skills-lock.json`](../skills-lock.json) — the `fastify-best-practices` and `drizzle-orm-patterns` entries show the exact format.

### Install command

```bash
claude skills install
```

This reads `skills-lock.json`, fetches each skill from GitHub, verifies the hash, and writes the skill file into `.claude/skills/`. Re-run this command after updating the lock file.

---

## 6. Versioning

Follow semver:

| Change                                                                                | Bump                          |
|---------------------------------------------------------------------------------------|-------------------------------|
| Add a new skill to the plugin                                                         | **patch** (`1.0.0` → `1.0.1`) |
| Change a skill's behaviour in a backwards-compatible way (add sections, refine rules) | **minor** (`1.0.0` → `1.1.0`) |
| Remove a skill, rename a skill, or change the `name` identifier                       | **major** (`1.0.0` → `2.0.0`) |
| Breaking change to the finding format, protocol, or gate behaviour                    | **major**                     |

Update `version` in both `plugin.json` (plugin-level) and the affected `SKILL.md` frontmatter (skill-level). They are independent — a plugin can be at `1.3.0` while individual skills sit at `1.0.0` or `2.1.0`.

---

## 7. Publishing to the Marketplace

1. **Add `marketplace.json`** to the repo root (see §2 above).
2. **Set `"private": false`** in `plugin.json`.
3. **Make the GitHub repo public.**
4. **Submit the plugin URL** to the Claude Code marketplace (Settings → Plugins → Submit).

The marketplace indexes `plugin.json` and `marketplace.json` from the repo's default branch. Changes take effect on the next index run (usually within a few hours of pushing).

To **unpublish**, set `"private": true` in `plugin.json` and push — the marketplace will stop serving the listing on the next index run. Existing importers with a pinned `computedHash` in their lock file are unaffected until they re-run `claude skills install`.

---

## 8. DevDigest-Specific Conventions

When adding a skill to **this repo**:

1. **Skill directory:** `.claude/skills/<skill-name>/` — use kebab-case.
2. **Register in `plugin.json`:** add `"<skill-name>": { "path": ".claude/skills/<skill-name>/SKILL.md" }`.
3. **Catalog:** add a row to `.claude/skills/README.md`.
4. **Hooks (optional):** if the skill needs a pre-tool-use hook, add it to `.claude/settings.json` under `hooks.PreToolUse`. See the `pr-self-review` hook as the reference pattern.
5. **Do not edit** `server/src/vendor/shared/` or `server/src/db/migrations/` — even if a skill touches those paths.
6. **INSIGHTS.md:** if you discover a non-obvious constraint while building the skill, record it in the relevant package's `INSIGHTS.md` via the `engineering-insights` skill.

---

## Quick Reference

| Task                            | File to edit                                 |
|---------------------------------|----------------------------------------------|
| Change plugin version           | `plugin.json` → `version`                    |
| Add a skill to the plugin       | `plugin.json` → `skills` map                 |
| Change marketplace listing copy | `marketplace.json`                           |
| Create a skill                  | `.claude/skills/<name>/SKILL.md`             |
| Import an external skill        | `skills-lock.json` + `claude skills install` |
| Wire a pre-tool hook            | `.claude/settings.json` → `hooks.PreToolUse` |
| Update the skill catalog        | `.claude/skills/README.md`                   |
