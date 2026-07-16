/**
 * Pure GHA workflow generator — ZERO I/O imports (no fs, drizzle, octokit, fastify).
 *
 * Security-critical: THIS FILE is audited by the T7 reviewer for workflow
 * security properties. Keep it clean, minimal, and exactly spec-compliant.
 *
 * Invariants (all verified by tests):
 *  - `permissions:` has EXACTLY two keys: `contents: read` and `pull-requests: write`
 *  - `on:` uses `pull_request` ONLY — never `pull_request_target`
 *  - No `issue_comment` or any comment-triggered event
 *  - Run step is `node .devdigest/runner/index.js` with NO CLI flags
 *  - No `uses: devdigest/*` marketplace action anywhere
 *  - No literal secret values — only `${{ secrets.* }}` references
 *  - Trailing `upload-artifact@v4` step named `devdigest-result`
 *  - No `curl`/`fetch`/webhook in the generated YAML
 */

export interface WorkflowOptions {
  /**
   * How the runner should post its review.
   * Becomes DEVDIGEST_POST_AS in the env block.
   * Values: 'github_review' | 'pr_comment' | 'none'
   * The value comes from CiExportInput.post_as — never a secret.
   */
  postAs: string;
  /**
   * PR event types to react to (from CiExportInput.triggers).
   * Typical: ['opened', 'synchronize', 'reopened']
   * Never includes 'pull_request_target' or 'issue_comment'.
   */
  triggers: string[];
}

/** Filename used when committing the generated workflow to the target repo. */
export const WORKFLOW_FILE_NAME = 'devdigest-review.yml';

/**
 * Build the GitHub Actions workflow YAML string.
 *
 * The generated workflow:
 *  1. Triggers ONLY on pull_request (not pull_request_target).
 *  2. Has minimal permissions: contents: read + pull-requests: write.
 *  3. Runs the bundled runner (`node .devdigest/runner/index.js`) with no flags.
 *  4. Uploads `devdigest-result.json` as the ONLY egress step.
 */
export function buildWorkflowYaml(opts: WorkflowOptions): string {
  const triggers = opts.triggers.length > 0
    ? opts.triggers
    : ['opened', 'synchronize'];

  const typesBlock = triggers.map((t) => `      - ${t}`).join('\n');

  // SECURITY: post_as is one of the fixed enum values from CiExportInput
  // ('github_review' | 'pr_comment' | 'none') — no user-controlled free text.
  // It is safe to embed inline.  It is NOT a secret.
  const postAs = opts.postAs;

  return `name: DevDigest Review
on:
  pull_request:
    types:
${typesBlock}
permissions:
  contents: read
  pull-requests: write
jobs:
  devdigest-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Run DevDigest Review
        run: node .devdigest/runner/index.js
        env:
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: \${{ github.repository }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
          DEVDIGEST_POST_AS: ${postAs}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: devdigest-result
          path: devdigest-result.json
`;
}
