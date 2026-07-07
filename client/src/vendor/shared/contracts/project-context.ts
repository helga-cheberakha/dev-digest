import { z } from 'zod';

/**
 * Project Context Folder contracts.
 * Shared between server and client (vendored, hand-synced).
 */

// ---- FolderKind ----
export const FolderKind = z.enum(['specs', 'docs', 'insights']);
export type FolderKind = z.infer<typeof FolderKind>;

// ---- DiscoveredDocument ----
export const DiscoveredDocument = z.object({
  path: z.string(),
  parent_path: z.string(),
  name: z.string(),
  folder_kind: FolderKind,
  size_bytes: z.number().int(),
  est_tokens: z.number().int(),
  used_by_agents: z.number().int(),
});
export type DiscoveredDocument = z.infer<typeof DiscoveredDocument>;

// ---- DiscoveryResponse ----
export const DiscoveryResponse = z.object({
  documents: z.array(DiscoveredDocument),
  truncated: z.boolean(),
  reason: z.string().optional(),
});
export type DiscoveryResponse = z.infer<typeof DiscoveryResponse>;

// ---- DocumentAttachment ----
export const DocumentAttachment = z
  .object({
    paths: z.array(z.string()).max(500),
    repoId: z.string().uuid().optional(),
  })
  .refine((v) => new Set(v.paths).size === v.paths.length, {
    message: 'paths must be unique',
    path: ['paths'],
  });
export type DocumentAttachment = z.infer<typeof DocumentAttachment>;

// ---- DocumentPreview ----
export const DocumentPreview = z.object({
  path: z.string(),
  content: z.string(),
});
export type DocumentPreview = z.infer<typeof DocumentPreview>;
