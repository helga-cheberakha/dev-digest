import { describe, it, expect } from 'vitest';
import { classifyFile } from './classifier.js';

describe('classifyFile', () => {
  describe('boilerplate', () => {
    it('classifies pnpm-lock.yaml as boilerplate', () => {
      expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
    });
    it('classifies yarn.lock as boilerplate', () => {
      expect(classifyFile('yarn.lock')).toBe('boilerplate');
    });
    it('classifies dist output as boilerplate', () => {
      expect(classifyFile('dist/main.js')).toBe('boilerplate');
    });
    it('classifies coverage report as boilerplate', () => {
      expect(classifyFile('coverage/lcov.info')).toBe('boilerplate');
    });
    it('classifies minified file as boilerplate', () => {
      expect(classifyFile('public/vendor.min.js')).toBe('boilerplate');
    });
  });

  describe('wiring', () => {
    it('classifies index.ts as wiring', () => {
      expect(classifyFile('src/index.ts')).toBe('wiring');
    });
    it('classifies routes file as wiring', () => {
      expect(classifyFile('src/modules/reviews/routes.ts')).toBe('wiring');
    });
    it('classifies DI container as wiring', () => {
      expect(classifyFile('src/platform/container.ts')).toBe('wiring');
    });
    it('classifies vitest config as wiring', () => {
      expect(classifyFile('vitest.config.ts')).toBe('wiring');
    });
    it('classifies GitHub Actions workflow as wiring', () => {
      expect(classifyFile('.github/workflows/ci.yml')).toBe('wiring');
    });
  });

  describe('core', () => {
    it('classifies a service file as core', () => {
      expect(classifyFile('src/modules/reviews/service.ts')).toBe('core');
    });
    it('classifies the classifier itself as core', () => {
      expect(classifyFile('src/modules/smart-diff/classifier.ts')).toBe('core');
    });
    it('classifies a React component as core', () => {
      expect(classifyFile('src/components/Button.tsx')).toBe('core');
    });
    it('classifies a utility module as core', () => {
      expect(classifyFile('src/lib/utils.ts')).toBe('core');
    });
    it('classifies a custom hook as core', () => {
      expect(classifyFile('src/hooks/useSmartDiff.ts')).toBe('core');
    });
  });
});
