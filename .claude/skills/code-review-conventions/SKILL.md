---
name: code-review-conventions
description: "Formalises how to conduct code reviews in DevDigest: severity levels (CRITICAL/HIGH/MEDIUM/LOW), when findings block vs. advise, structured finding format (file/line/severity/issue/fix), adversarial verification protocol, and reviewer etiquette. Load when writing review findings, triaging reviewer output, or deciding whether to block a PR."
user-invocable: true
version: "1.0.0"
---

# Code Review Conventions

This skill defines the **process layer** of code review — how to format findings, what severity
means, and what reviewer behaviour is expected. The automated gate is in
[pr-self-review](../pr-self-review/SKILL.md); this skill governs the judgement layer.

---

## Severity Scale

| Level | Meaning | Gate behaviour |
|-------|---------|----------------|
| **CRITICAL** | Verified bug, data loss, security vulnerability, or correctness breakage that affects production behaviour | **BLOCKS** the PR; must be fixed or explicitly suppressed |
| **HIGH** | Risky pattern, likely future breakage, clear deviation from project architecture | Reported as a warning; does not block on its own |
| **MEDIUM** | Suboptimal implementation, tech debt, missing guard | Advisory; reported for visibility |
| **LOW** | Style, naming, minor readability | Advisory; skip unless the file is already being touched for another reason |

**Rule:** When in doubt between two levels, pick the lower one. A CRITICAL that turns out to be wrong wastes time; a HIGH that turns out to be critical gets caught in the next review cycle.

---

## Finding Format

Every finding must be a structured object — no prose blobs:

```
{
  file:     "server/src/modules/reviews/review.service.ts",
  line:     142,
  severity: "CRITICAL",
  skill:    "security",
  issue:    "User-supplied `repoUrl` is interpolated directly into a shell command without sanitisation.",
  fix:      "Use execFile() with an explicit argument array, or validate against an allowlist of known repo patterns before exec."
}
```

Required fields: `file`, `line`, `severity`, `skill`, `issue`, `fix`.

- `skill` — which skill or knowledge domain identified this (e.g. `security`, `onion-architecture`, `fastify-best-practices`)
- `issue` — one sentence: what is wrong and why it matters
- `fix` — concrete, actionable remediation; never "consider refactoring"

---

## Adversarial Verification Protocol

Every CRITICAL **must survive a skeptic pass** before it can block.

After identifying a CRITICAL, ask: *"Can I construct a plausible argument that this is actually safe?"* If yes, try to build it. A CRITICAL that can be refuted is downgraded to HIGH — it is **not dropped**, but it cannot block. Record the downgrade reason in the finding.

This prevents false positives from blocking valid PRs. It does not apply to HIGH/MEDIUM/LOW.

---

## What Never Blocks

Even if flagged at CRITICAL severity, the following categories must be downgraded to HIGH before they appear in the gate:

- **Style / naming** — formatting, variable names, comment wording
- **Pre-existing code on untouched lines** — if the diff doesn't touch the line, it's out of scope
- **Test-file style** — structure and naming within test files (logic bugs still count)
- **Generated / vendor code** — `server/src/vendor/shared/`, `db/migrations/`, lockfiles, `node_modules`
- **Hypotheticals** — "this _could_ be a problem if someone adds X later" without a concrete scenario

---

## Suppression

To acknowledge a finding and skip blocking on it, add a comment on the same line:

```ts
const cmd = `git clone ${repoUrl}`; // pr-self-review-ignore: repoUrl validated upstream at API boundary
```

The gate reads this comment and removes the finding from the blocking set. The finding still appears in the report as `suppressed`. Suppression requires a reason — bare `// pr-self-review-ignore` is rejected.

---

## Reviewer Etiquette

- **One finding per distinct issue.** If the same bug appears on 5 lines, list the first occurrence with a note that it recurs; don't generate 5 identical findings.
- **Always include a fix.** A finding without a concrete fix is noise. If you don't know the right fix, say so explicitly — `fix: "Unknown — escalate to team"` is valid.
- **No hypotheticals without evidence.** "This might be slow" requires a profiling data point or a known O(n²) algorithm. Opinion without evidence → LOW or omit.
- **Separate concerns.** Architecture findings (wrong layer, wrong module) belong to `onion-architecture` or `frontend-architecture`; security findings to `security`; type safety to `typescript-expert`. Tag the `skill` field accurately so findings can be filtered.
- **Cite line numbers.** Always. Findings without line numbers cannot be acted on.

---

## Companion Skills

| Skill | When to load alongside this one |
|-------|--------------------------------|
| [pr-self-review](../pr-self-review/SKILL.md) | Automated gate — runs deterministic checks and routes findings |
| [security](../security/SKILL.md) | Identifying OWASP Top 10 issues for the `security` skill tag |
| [onion-architecture](../onion-architecture/SKILL.md) | Architecture-layer violations for backend findings |
| [engineering-insights](../engineering-insights/SKILL.md) | Capturing non-obvious patterns discovered during review |
