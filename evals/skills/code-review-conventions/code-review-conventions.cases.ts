import type { SkillCase } from "../../src/index.js";

// This skill's job is to judge real diffs, but "quality" cases run with no tools (skillTask
// measures the SKILL.md content in isolation — see tasks.ts). So each prompt inlines the
// code the skill would normally Read itself. Scenarios below are fresh — not copies of
// SKILL.md's own examples.md worked examples — so a judge scores whether the skill generalizes
// its stated rules, not whether the model has memorized the skill's own illustrations.

export const cases: SkillCase[] = [
  {
    name: "severity calibration: adversarial verification downgrades a misleading log line, not the parameterized query",
    kind: "quality",
    prompt: `Review this diff to server/src/modules/agents/repository.ts and report your finding using this project's structured finding format (file, line, severity, skill, issue, fix). ownerId is a non-secret internal UUID already returned in every /agents API response, so it is not a data-exposure concern by itself.

\`\`\`ts
import { db } from "../../db/client.js";
import { agents } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export async function findAgentsByOwner(ownerId: string) {
  console.log(\`fetching agents: SELECT * FROM agents WHERE owner_id = '\${ownerId}'\`);
  return db.select().from(agents).where(eq(agents.ownerId, ownerId));
}
\`\`\``,
    grounding: ["drizzle", "paramet"],
    practices: [
      "the finding's severity is not CRITICAL",
      "the answer states that the database query itself is safe because it uses Drizzle's eq(), which parameterizes the value, rather than string concatenation",
      "the finding's issue/fix is about the console.log statement being an unnecessary or misleading debug artifact, not about a SQL, command, or query injection vulnerability",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "structured finding format: all six required fields present for a verified null-dereference bug",
    kind: "quality",
    prompt: `Review this diff to server/src/modules/agents/routes.ts for correctness issues only — authorization is already enforced by upstream middleware not shown in this diff, so do not evaluate permissions. Report exactly one finding as a single object with exactly these six keys: file, line, severity, skill, issue, fix — not a table, not a prose summary, not a bulleted list.

\`\`\`ts
fastify.delete("/agents/:id", async (request, reply) => {
  const agent = await agentsRepository.findById(request.params.id);
  await agentsRepository.delete(agent.id);
  return reply.status(204).send();
});
\`\`\``,
    grounding: ["file", "line", "severity", "skill", "issue", "fix", "null"],
    practices: [
      "the fix field proposes an explicit if-check guard before the crashing line, not a vague instruction like 'add error handling'",
    ],
    threshold: 0.7,
    maxTurns: 10,
  },
  {
    name: "never blocks: pure naming issue on a touched line stays LOW, not CRITICAL",
    kind: "quality",
    prompt: `Review this diff to server/src/modules/agents/stats.ts. Report any issues with severity.

\`\`\`ts
export function formatAgentStats(agent: { runCount: number; lastRunAt: Date }) {
  const x = agent;
  return { count: x.runCount, lastRun: x.lastRunAt };
}
\`\`\``,
    grounding: ["LOW"],
    practices: [
      "the answer identifies the variable name 'x' as a style/naming concern rather than a correctness issue",
      "the answer does not classify this finding as CRITICAL or as something that blocks the PR",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "suppression protocol: a valid pr-self-review-ignore comment marks the finding suppressed, not dropped",
    kind: "quality",
    prompt: `Review this diff to server/src/modules/repos/clone.service.ts and report any issues, including how this project's process would treat the marked line.

\`\`\`ts
export async function cloneRepo(repoUrl: string) {
  await execFile("git", ["clone", repoUrl]); // pr-self-review-ignore: repoUrl comes from the GitHub webhook payload, already validated as a github.com URL by validateRepoUrl()
}
\`\`\``,
    grounding: ["suppress"],
    practices: [
      "the answer states that a finding on the marked line is not silently dropped but is still recorded/reported, just removed from the blocking set and marked as suppressed because of the pr-self-review-ignore comment",
      "the answer notes the suppression is valid because the comment includes a reason, not just the bare directive",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
