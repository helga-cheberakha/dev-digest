import type { SkillCase } from "../../src/index.js";

// This skill's job is to review real request-handling code, but "quality" cases run with no
// tools (skillTask measures the SKILL.md content in isolation — see tasks.ts). So the prompt
// inlines the diff the skill would normally Read itself. The scenario is built directly from
// SKILL.md's own "Core Philosophy — Confidence-Based Review" section and its A05/A09 guidance,
// so a judge can score against the skill's stated behavior rather than generic OWASP opinions.

export const cases: SkillCase[] = [
  {
    name: "confidence-based review flags the attacker-controlled NoSQL injection but does not flag the server-controlled status value",
    kind: "quality",
    prompt: `Review this diff to server/src/routes/auth.ts for security issues.

\`\`\`ts
import { Router } from "express";
import { User } from "../models/user.js";

const router = Router();

router.get("/health", (req, res) => {
  res.json({ status: process.env.STATUS_MESSAGE ?? "ok" });
});

router.post("/login", async (req, res) => {
  const user = await User.findOne({ email: req.body.email, isActive: true });
  if (!user || !(await user.comparePassword(req.body.password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  console.log(\`login success for \${user.email}, password: \${req.body.password}\`);
  return res.json({ token: user.issueToken() });
});

export default router;
\`\`\`

Report any issues you find with severity.`,
    practices: [
      "the answer flags 'User.findOne({ email: req.body.email, ... })' as a NoSQL operator-injection risk because req.body.email is attacker-controlled and passed into the query without being cast to a string, allowing an object like { \"$gt\": \"\" }",
      "the recommended fix is to cast the value explicitly, e.g. String(req.body.email), or otherwise sanitize/strip '$' keys before the query — not a vague 'validate input' statement",
      "the answer separately flags the console.log call that logs req.body.password as a logging failure (plaintext password in logs) and recommends removing it or otherwise not logging password values",
      "the answer does NOT flag the /health route's process.env.STATUS_MESSAGE as attacker-controlled or vulnerable, since it is a server-controlled value, not user input",
      "the NoSQL injection and the password-in-logs issues are each given an explicit severity rather than left unranked",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
