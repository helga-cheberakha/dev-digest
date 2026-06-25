/**
 * Path-pattern constants for Smart Diff file classification.
 * Boilerplate is checked first; wiring second; everything else is core.
 * Adding or adjusting patterns here is the only change needed to retune classification.
 */

export const BOILERPLATE_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)package-lock\.json$/,
  /(?:^|\/)yarn\.lock$/,
  /(?:^|\/)pnpm-lock\.yaml$/,
  /\.lock$/,
  /(?:^|\/)dist\//,
  /(?:^|\/)build\//,
  /(?:^|\/)\.next\//,
  /\.snap$/,
  /(?:^|\/)coverage\//,
  /(?:^|\/)node_modules\//,
  /(?:^|\/)__generated__\//,
  /\.min\.(js|css)$/,
  /(?:^|\/)\.yarn\//,
  /(?:^|\/)storybook-static\//,
];

export const WIRING_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)index\.(ts|tsx|js|jsx|mts|mjs)$/,
  /\/routes?\.(ts|js)$/,
  /(?:^|\/)container\.(ts|js)$/,
  /\.config\.(ts|js|mjs|cjs|json)$/,
  /(?:^|\/)tsconfig/,
  /(?:^|\/)vitest\.config/,
  /(?:^|\/)jest\.config/,
  /(?:^|\/)\.(eslint|prettier)/,
  /(?:^|\/)Dockerfile/,
  /(?:^|\/)docker-compose/,
  /(?:^|\/)\.github\//,
  /(?:^|\/)migrations\//,
  /(?:^|\/)schema\.(ts|js)$/,
  /(?:^|\/)\.(env|envrc)/,
  /(?:^|\/)Makefile$/,
];

/** Total changed lines (additions + deletions) above which a PR is flagged "too big". */
export const TOO_BIG_THRESHOLD = 400;
