# Code Review Conventions — Examples

## Severity Judgement

### CRITICAL — verified bug
```
Scenario: auth middleware reads `req.user.id` but the middleware is not registered on this route.
→ CRITICAL: null dereference at runtime on the first authenticated request.
```

### HIGH — risky pattern, not yet broken
```
Scenario: service layer imports directly from the transport layer (Fastify request object).
→ HIGH (not CRITICAL): doesn't crash today, but violates onion-architecture and will break
   if the transport is ever swapped. The fix is clear; the risk is architectural drift.
```

### MEDIUM — tech debt, not urgent
```
Scenario: a helper function duplicated verbatim in two modules.
→ MEDIUM: works correctly today; creates maintenance risk if one copy diverges.
```

### LOW — style only
```
Scenario: variable named `data` instead of `reviewPayload`.
→ LOW (or omit if the file isn't already being modified): naming clarity, no correctness risk.
```

---

## Finding Format — Good vs Bad

### Bad finding (no line, no fix, vague)
```json
{
  "severity": "HIGH",
  "issue": "This looks like it could be a security problem with how the token is handled."
}
```
Problems: missing `file`, `line`, `skill`, `fix`; "looks like it could be" is a hypothesis, not evidence.

### Good finding
```json
{
  "file": "server/src/modules/auth/auth.routes.ts",
  "line": 88,
  "severity": "HIGH",
  "skill": "security",
  "issue": "JWT secret is read from process.env inside the route handler on every request instead of once at plugin registration, making it impossible to detect a missing secret at startup.",
  "fix": "Read JWT_SECRET in the plugin registration function and throw if absent. Pass it down to handlers via fastify.decorate()."
}
```

---

## Adversarial Verification — Worked Example

**Initial CRITICAL finding:**
```
file: server/src/modules/repos/repo.service.ts, line: 67
issue: repoUrl from user input passed directly to child_process.exec()
```

**Skeptic pass:** "Is repoUrl validated before reaching this point?"

**Investigation:** Check the call chain — `repo.routes.ts:42` validates against a Zod schema that allows any string matching `/^https?:\/\/.+/`. That regex does not prevent shell metacharacters like `; rm -rf /`.

**Result:** Validation does not protect against command injection. CRITICAL stands.

---

**Initial CRITICAL finding:**
```
file: server/src/modules/reviews/review.service.ts, line: 201
issue: SQL query built with string concatenation — SQL injection risk
```

**Skeptic pass:** "Is Drizzle ORM used here, which parameterises automatically?"

**Investigation:** Yes — line 201 uses `db.select().from(reviews).where(eq(reviews.id, id))`. Drizzle parameterises all values; no string concatenation is happening. The reviewer misread a template literal in a log statement on line 200.

**Result:** Not a real vulnerability. Downgraded to LOW (misleading log format), not dropped — note added: "CRITICAL refuted: Drizzle ORM parameterises automatically; log statement on line 200 is cosmetic."

---

## Suppression — Correct Usage

```ts
// Correct: includes a reason
exec(buildCommand, options); // pr-self-review-ignore: buildCommand assembled from allowlist constants only, not user input

// Incorrect: no reason — gate rejects this
exec(buildCommand, options); // pr-self-review-ignore
```

---

## Recurring Mistake: Out-of-Scope Findings

```
Bad: "The legacy endpoint /api/v1/repos (line 12) uses a deprecated auth pattern."
     → line 12 was not modified in this diff. Out of scope; omit entirely.

Good: Flag only if the diff touches line 12 or a function that calls it.
```
