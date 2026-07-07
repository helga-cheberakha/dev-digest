/**
 * howToRun.test.ts — unit tests for analyzeHowToRun (AC-10)
 *
 * Oracle: AC-10 observable — "How-to-run is populated with the LLM stubbed off."
 * This is a pure function; every test here exercises it with no LLM involvement.
 */

import { describe, it, expect } from 'vitest';
import { analyzeHowToRun } from './howToRun.js';
import type { HowToRunInput } from './howToRun.js';

// ---------------------------------------------------------------------------
// AC-10: How-to-run populated deterministically (no LLM)
// ---------------------------------------------------------------------------

describe('analyzeHowToRun — AC-10: populated with LLM stubbed off', () => {
  it('returns a non-empty step list from npm lockfile + dev script alone', () => {
    // This is the minimal valid input matching a JS/TS project.
    // No LLM is invoked — the function is pure.
    const input: HowToRunInput = {
      lockfileName: 'package-lock.json',
      packageJsonScripts: { dev: 'node server.js', test: 'vitest' },
      dockerComposeServices: [],
      envExampleVarNames: [],
    };
    const steps = analyzeHowToRun(input);
    expect(steps.length).toBeGreaterThan(0);
    // At minimum: install + start dev server
    const commands = steps.map((s) => s.command);
    expect(commands).toContain('npm install');
    const stepDescriptions = steps.map((s) => s.step);
    expect(stepDescriptions.some((d) => d.toLowerCase().includes('development'))).toBe(true);
  });

  it('uses pnpm commands when pnpm-lock.yaml is the lockfile', () => {
    const input: HowToRunInput = {
      lockfileName: 'pnpm-lock.yaml',
      packageJsonScripts: { dev: 'vite' },
      dockerComposeServices: [],
      envExampleVarNames: [],
    };
    const steps = analyzeHowToRun(input);
    const commands = steps.map((s) => s.command);
    expect(commands).toContain('pnpm install');
    expect(commands.some((c) => c.startsWith('pnpm'))).toBe(true);
  });

  it('includes a docker-compose step when services are present', () => {
    const input: HowToRunInput = {
      lockfileName: 'package-lock.json',
      packageJsonScripts: { dev: 'ts-node src/index.ts' },
      dockerComposeServices: ['postgres', 'redis'],
      envExampleVarNames: [],
    };
    const steps = analyzeHowToRun(input);
    const commands = steps.map((s) => s.command);
    expect(commands).toContain('docker compose up -d');
    const descriptions = steps.map((s) => s.step);
    expect(descriptions.some((d) => d.includes('postgres'))).toBe(true);
    expect(descriptions.some((d) => d.includes('redis'))).toBe(true);
  });

  it('includes an env-copy step with variable names when .env.example vars are present', () => {
    const input: HowToRunInput = {
      lockfileName: 'package-lock.json',
      packageJsonScripts: {},
      dockerComposeServices: [],
      envExampleVarNames: ['DATABASE_URL', 'API_KEY', 'PORT'],
    };
    const steps = analyzeHowToRun(input);
    const commands = steps.map((s) => s.command);
    expect(commands).toContain('cp .env.example .env');
    // The step description must mention variable names, never values
    const envStep = steps.find((s) => s.command === 'cp .env.example .env');
    expect(envStep?.step).toContain('DATABASE_URL');
  });

  it('includes setup-script steps (db:migrate) in the correct order before dev start', () => {
    const input: HowToRunInput = {
      lockfileName: 'package-lock.json',
      packageJsonScripts: {
        'db:migrate': 'drizzle-kit migrate',
        dev: 'tsx src/index.ts',
      },
      dockerComposeServices: [],
      envExampleVarNames: [],
    };
    const steps = analyzeHowToRun(input);
    const commands = steps.map((s) => s.command);
    const migrateIdx = commands.findIndex((c) => c.includes('db:migrate'));
    const devIdx = commands.findIndex((c) => c.includes('dev'));
    expect(migrateIdx).toBeGreaterThanOrEqual(0);
    expect(devIdx).toBeGreaterThanOrEqual(0);
    // Setup scripts appear before the dev server
    expect(migrateIdx).toBeLessThan(devIdx);
  });

  it('produces ordered steps: install → env → docker → setup → server', () => {
    const input: HowToRunInput = {
      lockfileName: 'package-lock.json',
      packageJsonScripts: {
        'db:migrate': 'npm run db:migrate',
        dev: 'tsx watch src/index.ts',
      },
      dockerComposeServices: ['postgres'],
      envExampleVarNames: ['DATABASE_URL'],
    };
    const steps = analyzeHowToRun(input);
    const commands = steps.map((s) => s.command);
    const installIdx = commands.indexOf('npm install');
    const envIdx = commands.indexOf('cp .env.example .env');
    const dockerIdx = commands.indexOf('docker compose up -d');
    const devIdx = commands.findIndex((c) => c.includes('dev'));
    // All present
    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(envIdx).toBeGreaterThanOrEqual(0);
    expect(dockerIdx).toBeGreaterThanOrEqual(0);
    expect(devIdx).toBeGreaterThanOrEqual(0);
    // Ordered correctly
    expect(installIdx).toBeLessThan(envIdx);
    expect(envIdx).toBeLessThan(dockerIdx);
    expect(dockerIdx).toBeLessThan(devIdx);
  });

  it('returns empty array when no facts are available (no lockfile, no scripts)', () => {
    // AC-10 edge case: empty .env.example / no scripts — proceeds from whatever exists
    // When truly nothing is available, returns an empty array (valid per no-.min() schema).
    const input: HowToRunInput = {
      lockfileName: undefined,
      packageJsonScripts: undefined,
      dockerComposeServices: [],
      envExampleVarNames: [],
    };
    const steps = analyzeHowToRun(input);
    expect(steps).toEqual([]);
  });

  it('uses yarn commands for yarn.lock', () => {
    const input: HowToRunInput = {
      lockfileName: 'yarn.lock',
      packageJsonScripts: { dev: 'react-scripts start' },
      dockerComposeServices: [],
      envExampleVarNames: [],
    };
    const steps = analyzeHowToRun(input);
    const commands = steps.map((s) => s.command);
    expect(commands).toContain('yarn install');
    expect(commands.some((c) => c.startsWith('yarn '))).toBe(true);
  });

  it('falls back to start script when no dev script exists', () => {
    const input: HowToRunInput = {
      lockfileName: 'package-lock.json',
      packageJsonScripts: { start: 'node dist/index.js', build: 'tsc' },
      dockerComposeServices: [],
      envExampleVarNames: [],
    };
    const steps = analyzeHowToRun(input);
    const commands = steps.map((s) => s.command);
    expect(commands).toContain('npm run start');
  });
});
