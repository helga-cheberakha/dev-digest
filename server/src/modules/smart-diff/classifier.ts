import type { SmartDiffRole } from '@devdigest/shared';
import { BOILERPLATE_PATTERNS, WIRING_PATTERNS } from './constants.js';

/** Classify a single file path as core / wiring / boilerplate. */
export function classifyFile(path: string): SmartDiffRole {
  for (const pattern of BOILERPLATE_PATTERNS) {
    if (pattern.test(path)) return 'boilerplate';
  }
  for (const pattern of WIRING_PATTERNS) {
    if (pattern.test(path)) return 'wiring';
  }
  return 'core';
}
