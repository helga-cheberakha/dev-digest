/**
 * howToRun.ts — deterministic How-to-run step generator.
 *
 * Pure, I/O-free. The service (T10) reads clone files via container.git.readFile
 * and passes parsed facts here; this function only computes, never reads.
 *
 * AC-10: the output is fully determined by the supplied facts; no LLM call is needed.
 *
 * SECURITY: `envExampleVarNames` carries ONLY variable names, never values.
 * The service MUST NOT pass the contents of `.env` (which contains real secrets) —
 * only the names extracted from `.env.example` are accepted here.
 */

import type { HowToRunStep } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Public input contract
// ---------------------------------------------------------------------------

/**
 * Clone facts collected by the service (T10) and passed in ready-parsed.
 *
 * SECURITY NOTE: `envExampleVarNames` must carry only the variable *names*
 * extracted from `.env.example`.  Variable values (from `.env`) must never
 * be passed into this function — they are secrets.
 */
export interface HowToRunInput {
  /**
   * Name of the lockfile found at the repo root
   * (e.g. `'package-lock.json'`, `'yarn.lock'`, `'pnpm-lock.yaml'`, `'bun.lockb'`).
   * `undefined` when no recognised lockfile is present.
   */
  lockfileName: string | undefined;
  /**
   * Parsed `scripts` section from `package.json`.
   * `undefined` when the repo has no `package.json`.
   */
  packageJsonScripts: Record<string, string> | undefined;
  /**
   * Docker Compose service names extracted from `docker-compose.yml` /
   * `docker-compose.yaml`.  Empty array when no compose file is present.
   */
  dockerComposeServices: string[];
  /**
   * Variable *names* extracted from `.env.example` — values are never passed.
   * Empty array when no `.env.example` is present.
   */
  envExampleVarNames: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported — T14 tests only exercise `analyzeHowToRun`)
// ---------------------------------------------------------------------------

type PackageManager =
  | 'npm'
  | 'yarn'
  | 'pnpm'
  | 'bun'
  | 'pip'
  | 'pipenv'
  | 'poetry'
  | 'bundle'
  | 'go'
  | 'cargo'
  | 'unknown';

/**
 * Maps well-known lockfile names to their package manager.
 * Listed in descending specificity so the first match wins.
 */
const LOCKFILE_PM_MAP: Record<string, PackageManager> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
  'package-lock.json': 'npm',
  'Pipfile.lock': 'pipenv',
  'poetry.lock': 'poetry',
  'requirements.txt': 'pip',
  'Gemfile.lock': 'bundle',
  'go.sum': 'go',
  'Cargo.lock': 'cargo',
};

function detectPm(lockfileName: string | undefined, hasPackageJson: boolean): PackageManager {
  if (lockfileName !== undefined) {
    return LOCKFILE_PM_MAP[lockfileName] ?? 'unknown';
  }
  // No lockfile but a package.json → assume npm (most conservative default).
  return hasPackageJson ? 'npm' : 'unknown';
}

function installCommand(pm: PackageManager): string | undefined {
  const commands: Partial<Record<PackageManager, string>> = {
    npm: 'npm install',
    yarn: 'yarn install',
    pnpm: 'pnpm install',
    bun: 'bun install',
    pip: 'pip install -r requirements.txt',
    pipenv: 'pipenv install',
    poetry: 'poetry install',
    bundle: 'bundle install',
    go: 'go mod download',
    cargo: 'cargo build',
  };
  return commands[pm];
}

/**
 * Returns the command to run a named npm script using the detected package manager.
 * For non-JS package managers the caller never reaches this path (no `packageJsonScripts`).
 */
function runScript(pm: PackageManager, script: string): string {
  switch (pm) {
    case 'yarn':
      return `yarn ${script}`;
    case 'pnpm':
      return `pnpm run ${script}`;
    case 'bun':
      return `bun run ${script}`;
    default:
      return `npm run ${script}`;
  }
}

/**
 * One-time setup script names checked in order.
 * Only scripts that are explicitly present in `package.json` are added.
 */
const SETUP_SCRIPTS = [
  'db:migrate',
  'db:setup',
  'db:seed',
  'migrate',
  'setup',
  'prisma:migrate',
  'prisma:generate',
] as const;

/**
 * Preferred development-server script names, checked in order.
 * The first match wins; `'start'` is used as a final fallback.
 */
const DEV_START_SCRIPTS = ['dev', 'start:dev', 'develop'] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive ordered How-to-run steps from deterministically collected clone facts.
 *
 * Steps are produced in the following order when the relevant facts are present:
 *  1. Install dependencies (from lockfile / package manager)
 *  2. Configure environment (`.env.example` variable names only)
 *  3. Start Docker services
 *  4. One-time setup scripts (`db:migrate`, migrations, etc.)
 *  5. Development / production server
 *
 * Returns an empty array when no facts are available — this is valid under the
 * shared schema (`.max()`-only, no `.min()`).  Satisfies AC-10.
 */
export function analyzeHowToRun(input: HowToRunInput): HowToRunStep[] {
  const { lockfileName, packageJsonScripts, dockerComposeServices, envExampleVarNames } = input;
  const steps: HowToRunStep[] = [];
  const pm = detectPm(lockfileName, packageJsonScripts !== undefined);

  // -- 1. Install dependencies --
  const install = installCommand(pm);
  if (install !== undefined) {
    steps.push({ step: 'Install dependencies', command: install });
  }

  // -- 2. Configure environment (variable names only — never values) --
  if (envExampleVarNames.length > 0) {
    const preview = envExampleVarNames.slice(0, 3).join(', ');
    const suffix = envExampleVarNames.length > 3 ? ', …' : '';
    steps.push({
      step: `Copy the example environment file and fill in the required variables (${preview}${suffix})`,
      command: 'cp .env.example .env',
    });
  }

  // -- 3. Start Docker services --
  if (dockerComposeServices.length > 0) {
    const serviceList = dockerComposeServices.join(', ');
    steps.push({
      step: `Start Docker services (${serviceList})`,
      command: 'docker compose up -d',
    });
  }

  // -- 4. One-time setup scripts --
  if (packageJsonScripts !== undefined) {
    for (const name of SETUP_SCRIPTS) {
      if (Object.prototype.hasOwnProperty.call(packageJsonScripts, name)) {
        steps.push({
          step: `Run the ${name} script`,
          command: runScript(pm, name),
        });
      }
    }
  }

  // -- 5. Development / production server --
  if (packageJsonScripts !== undefined) {
    let devAdded = false;

    for (const name of DEV_START_SCRIPTS) {
      if (Object.prototype.hasOwnProperty.call(packageJsonScripts, name)) {
        steps.push({
          step: 'Start the development server',
          command: runScript(pm, name),
        });
        devAdded = true;
        break;
      }
    }

    if (!devAdded && Object.prototype.hasOwnProperty.call(packageJsonScripts, 'start')) {
      steps.push({
        step: 'Start the application',
        command: runScript(pm, 'start'),
      });
    }
  }

  return steps;
}
