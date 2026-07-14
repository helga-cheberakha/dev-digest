import type { SkillCase } from "../../src/index.js";

// This skill's job is to reason about real backend files, but "quality" cases run with no tools
// (skillTask measures the SKILL.md content in isolation — see tasks.ts). So each prompt inlines
// the code the skill would normally Read itself, standing in for that file access. Scenarios
// below are built directly from SKILL.md / layer-map.md's own rules and worked examples, so a
// judge can score against the skill's stated behavior rather than generic architecture opinions.

export const cases: SkillCase[] = [
  {
    name: "walks the import closure two hops out instead of clearing the first-hop file",
    kind: "quality",
    prompt: `Review this diff to server/src/modules/reviews/service.ts for onion-architecture layering. The diff only touches helpers/render.ts, but I'm giving you the full chain reachable from the changed function so you can judge it properly.

server/src/modules/reviews/service.ts (unchanged, imports the diffed file):
\`\`\`ts
import { renderSummary } from "./helpers/render.js";

export async function finalizeReview(reviewId: string) {
  const summary = await renderSummary(reviewId);
  return summary;
}
\`\`\`

server/src/modules/reviews/helpers/render.ts (this is the diff):
\`\`\`ts
import { reviewStats } from "./stats.js";

export async function renderSummary(reviewId: string) {
  const stats = await reviewStats(reviewId);
  return \`Review \${reviewId}: \${stats.findingCount} findings\`;
}
\`\`\`

server/src/modules/reviews/helpers/stats.ts (unchanged, imported by the diffed file):
\`\`\`ts
import { db } from "../../../db/schema.js";

export async function reviewStats(reviewId: string) {
  return db.query.reviews.findFirst({ where: (r, { eq }) => eq(r.id, reviewId) });
}
\`\`\`

Is this diff clean from a layering standpoint?`,
    grounding: ["stats.ts", "db/schema"],
    practices: [
      "the answer does not clear render.ts as clean just because render.ts itself contains no direct database or SDK import",
      "the answer explicitly follows the relative import from render.ts into stats.ts and identifies that stats.ts queries db/schema directly",
      "the answer states this is a violation because only a repository.ts file is allowed to touch db/schema, not an arbitrary helper",
      "the answer attributes the violation as a chain reaching from service.ts through render.ts into stats.ts and down to db/schema, not just naming stats.ts in isolation",
      "the recommended fix is to move the database query into a repository file, not to add a one-off exception",
    ],
    threshold: 0.65,
    maxTurns: 10,
  },
  {
    name: "decision framework routes a new external integration through port -> adapter -> mock -> container, port name has no vendor in it",
    kind: "quality",
    prompt: `We want to add a feature: when a review finishes, post a message to a Slack channel via the Slack Web API. Using our onion-architecture layering rules, tell me exactly where each piece of this feature should live and in what order I should build it. This is server-side (server/ + reviewer-core/), not client/.`,
    practices: [
      "the answer says to define a port/interface first, in @devdigest/shared (src/vendor/shared/adapters.ts), before writing any Slack-specific code",
      "the port/interface the answer proposes is named after what the application needs (e.g. a notification or alert capability) and does not contain the vendor name 'Slack' in the interface itself",
      "the answer describes implementing a separate adapter under src/adapters/<kind>/ that wraps the Slack SDK and implements that port",
      "the answer mentions adding a mock implementation (e.g. in src/adapters/mocks.ts) so tests can inject it instead of the real Slack client",
      "the answer says the new port/adapter must be wired into platform/container.ts (the composition root) as a lazy getter, and that ContainerOverrides should get a field for it so tests can override it",
      "the answer states that the service consuming this feature must go through container.<port>() and must never import or call the Slack SDK directly",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "severity calibration: layering drift stays below CRITICAL, the real functional bug is still caught, review closes with the depcruise gate",
    kind: "quality",
    prompt: `Review this diff to server/src/modules/agents/service.ts for both architecture and correctness. Give each issue you find a severity.

\`\`\`ts
import { Octokit } from "octokit";
import { agentsRepository } from "./repository.js";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function dispatchPendingAgentRuns() {
  const pending = await agentsRepository.findPending();
  for (const run of pending) {
    run.status = "dispatched"; // mark so we don't double-dispatch in this loop
    await octokit.rest.issues.createComment({
      owner: run.owner,
      repo: run.repo,
      issue_number: run.issueNumber,
      body: \`Starting agent run \${run.id}\`,
    });
    // agentsRepository.markDispatched(run.id) is never called here
  }
}
\`\`\``,
    grounding: ["depcruise"],
    practices: [
      "the answer flags constructing 'new Octokit(...)' and calling it directly inside modules/agents/service.ts as a layering violation, since services must reach GitHub through the container/GitHubClient port instead of instantiating the SDK themselves",
      "the answer identifies the functional bug: 'run.status = \"dispatched\"' only mutates the in-memory object and is never persisted (e.g. via a markDispatched repository call), so findPending() will return the same run again next cycle and post a duplicate GitHub comment",
      "the answer does not mark the direct-Octokit-import layering issue as CRITICAL severity, treating it as HIGH at most since by itself it names no runtime defect",
      "the answer treats the missing-persistence duplicate-dispatch bug as more severe than the layering issue, since it is a verified functional bug that causes duplicate GitHub comments in production",
      "the review closes by telling the author to run the depcruise check (npm run depcruise or depcruise:all) before merging",
    ],
    threshold: 0.65,
    maxTurns: 10,
  },
];
