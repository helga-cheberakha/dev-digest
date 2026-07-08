import { z } from 'zod';

/**
 * OnboardingArtifact contract — per-repo Onboarding Tour.
 *
 * Added as a NEW file. The existing `Onboarding` placeholder in knowledge.ts is
 * intentionally left untouched (dead/superseded — scheduled for follow-up removal).
 *
 * Shared between server and client (vendored, hand-synced).
 *
 * DECISION: section arrays carry `.max()` caps ONLY — no `.min()`.
 * Degraded skeletons legitimately produce 0-entry sections and must
 * `.parse()` successfully. Happy-path minimums (criticalPaths ≥ 5,
 * readingPath ≥ 3, firstTasks ≥ 2 unless honestly omitted) are enforced
 * as service-layer assertions in T10, not in this schema.
 */

// ---- Node / Edge (architecture diagram) ----

export const OnboardingNodeKind = z.enum(['file', 'package', 'service', 'overflow']);
export type OnboardingNodeKind = z.infer<typeof OnboardingNodeKind>;

export const OnboardingNode = z.object({
  id: z.string(),
  label: z.string(),
  kind: OnboardingNodeKind,
});
export type OnboardingNode = z.infer<typeof OnboardingNode>;

export const OnboardingEdge = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
});
export type OnboardingEdge = z.infer<typeof OnboardingEdge>;

// ---- Architecture section ----

export const OnboardingDiagram = z.object({
  nodes: z.array(OnboardingNode),
  edges: z.array(OnboardingEdge),
});
export type OnboardingDiagram = z.infer<typeof OnboardingDiagram>;

export const ArchitectureStyle = z.enum([
  'modular',
  'layered',
  'monolithic',
  'event-driven',
  'microservices',
  'unknown',
]);
export type ArchitectureStyle = z.infer<typeof ArchitectureStyle>;

export const ArchitectureSection = z.object({
  overview: z.string(),
  style: ArchitectureStyle,
  diagram: OnboardingDiagram,
});
export type ArchitectureSection = z.infer<typeof ArchitectureSection>;

// ---- Section item types ----

export const CriticalPathEntry = z.object({
  file: z.string(),
  rationale: z.string(),
  link: z.string(),
});
export type CriticalPathEntry = z.infer<typeof CriticalPathEntry>;

export const HowToRunStep = z.object({
  step: z.string(),
  command: z.string(),
});
export type HowToRunStep = z.infer<typeof HowToRunStep>;

export const ReadingPathEntry = z.object({
  file: z.string(),
  rationale: z.string(),
  link: z.string(),
});
export type ReadingPathEntry = z.infer<typeof ReadingPathEntry>;

export const FirstTaskEntry = z.object({
  title: z.string(),
  suggestedPath: z.string(),
  gapType: z.string(),
  rationale: z.string(),
  patternPointer: z.string(),
  complexity: z.string(),
});
export type FirstTaskEntry = z.infer<typeof FirstTaskEntry>;

// ---- OnboardingArtifact (root) ----

export const OnboardingArtifact = z.object({
  repoName: z.string(),
  filesIndexed: z.number().int(),
  generatedAt: z.string(),
  headSha: z.string(),
  degraded: z.boolean().optional(),
  degradedReason: z.string().optional(),
  narrativeUnavailable: z.boolean().optional(),
  sections: z.object({
    architecture: ArchitectureSection,
    criticalPaths: z.array(CriticalPathEntry).max(8),
    howToRun: z.array(HowToRunStep),
    readingPath: z.array(ReadingPathEntry).max(5),
    firstTasks: z.array(FirstTaskEntry).max(3).optional(),
  }),
});
export type OnboardingArtifact = z.infer<typeof OnboardingArtifact>;
