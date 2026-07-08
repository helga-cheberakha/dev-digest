import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risk, Smart Diff, and the
 * Why+Risk Brief itself (`Brief`, persisted to pr_brief.json).
 */

// ---- Intent ----
export const Intent = z.object({
  summary: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const PriorPr = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  opened_at: z.string().nullable(),
  status: z.string(),
});
export type PriorPr = z.infer<typeof PriorPr>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  prior_prs: z.array(PriorPr).optional(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const RiskAreaKind = z.enum([
  'security',
  'dependency',
  'performance',
  'data',
  'api_change',
  'other',
]);
export type RiskAreaKind = z.infer<typeof RiskAreaKind>;

export const Risk = z.object({
  kind: RiskAreaKind,
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Why+Risk Brief (pr_brief.json) ----
export const ReviewFocusItem = z.object({
  label: z.string(),
  file_refs: z.array(z.string()),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

export const Brief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: z.enum(['low', 'medium', 'high']),
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
});
export type Brief = z.infer<typeof Brief>;
