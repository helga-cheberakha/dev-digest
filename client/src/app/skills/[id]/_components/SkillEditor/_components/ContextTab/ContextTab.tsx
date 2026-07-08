/* ContextTab — Skill editor tab for attaching project context documents.
   Shows discovered .md files (specs/docs/insights) with drag-reorder, checkbox
   attach/detach, folder-kind badge, and a dismissible preview drawer.
   AC-20, AC-22, AC-23, AC-27. */
"use client";
import React from "react";
import { Badge, Drawer, Skeleton } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { DiscoveredDocument } from "@devdigest/shared";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import {
  useSkillDocuments,
  useSetSkillDocuments,
  useDiscoveredDocuments,
  useDocumentPreview,
} from "../../../../../../../lib/hooks/project-context";
import { useActiveRepo } from "../../../../../../../lib/repo-context";

// ---- Sub-component: single document row ----
// Extracted outside ContextTab body to avoid render-factory anti-pattern.

const FOLDER_KIND_COLORS: Record<string, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

interface DocRowProps {
  doc: DiscoveredDocument;
  attached: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnter?: () => void;
  onDragEnd?: () => void;
  onToggle: () => void;
  onPreview: () => void;
  isPreviewing: boolean;
  previewLabel: string;
}

function DocRow({
  doc,
  attached,
  draggable = false,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onToggle,
  onPreview,
  isPreviewing,
  previewLabel,
}: DocRowProps) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragEnd={onDragEnd}
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 6,
        marginBottom: 4,
        border: "1px solid var(--border)",
        background: attached ? "var(--bg-surface)" : undefined,
        opacity: attached ? 1 : 0.7,
        cursor: draggable ? "grab" : "default",
      }}
    >
      {draggable ? (
        <span
          style={{ color: "var(--text-muted)", cursor: "grab", flexShrink: 0, fontSize: 14 }}
          aria-hidden="true"
        >
          ⠿
        </span>
      ) : (
        <div style={{ width: 14, flexShrink: 0 }} />
      )}
      <input
        type="checkbox"
        checked={attached}
        onChange={onToggle}
        aria-label={attached ? `Detach ${doc.name}` : `Attach ${doc.name}`}
        style={{ cursor: "pointer", flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{doc.name}</span>
        {doc.parent_path && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>
            {doc.parent_path}
          </span>
        )}
      </div>
      <Badge color={FOLDER_KIND_COLORS[doc.folder_kind] ?? "var(--text-secondary)"} mono>
        {doc.folder_kind}
      </Badge>
      <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
        ≈{doc.est_tokens}t
      </span>
      <button
        onClick={onPreview}
        aria-label={`${previewLabel} ${doc.name}`}
        style={{
          background: "none",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "2px 7px",
          fontSize: 11,
          cursor: "pointer",
          color: isPreviewing ? "var(--accent)" : "var(--text-secondary)",
          flexShrink: 0,
        }}
      >
        {previewLabel}
      </button>
    </div>
  );
}

// ---- Main component ----

export function ContextTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills");
  const { repoId } = useActiveRepo();
  const { data: discovery, isLoading: discoveryLoading } = useDiscoveredDocuments(repoId);
  const { data: attachment, isLoading: attachLoading } = useSkillDocuments(skillId);
  const setDocs = useSetSkillDocuments();

  const [orderedPaths, setOrderedPaths] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const dragItem = React.useRef<number | null>(null);
  const dragOverItem = React.useRef<number | null>(null);

  // Sync local order from server data on first load / skill change.
  React.useEffect(() => {
    if (attachment) {
      setOrderedPaths(attachment.paths);
    }
  }, [attachment]);

  const { data: previewData, isLoading: previewLoading } = useDocumentPreview(previewPath, repoId);

  if (discoveryLoading || attachLoading) return <Skeleton height={200} />;

  const allDocs = discovery?.documents ?? [];
  const docMap = new Map(allDocs.map((d: DiscoveredDocument) => [d.path, d]));
  const attachedSet = new Set(orderedPaths);

  // AC-22: Token total — derived each render from orderedPaths (Derive, Don't Store).
  const totalTokens = orderedPaths.reduce((sum, path) => {
    const doc = docMap.get(path);
    return sum + (doc?.est_tokens ?? 0);
  }, 0);

  // AC-23: SERIALIZES AS text — derived each render, no useState mirror, no backend call.
  const serializesAsText =
    orderedPaths.length > 0
      ? `## Project context\n\n${orderedPaths.map((p) => `- ${p}`).join("\n")}`
      : null;

  const filteredDocs = allDocs.filter(
    (d: DiscoveredDocument) =>
      !search || d.name.toLowerCase().includes(search.toLowerCase()),
  );

  const previewDoc = previewPath ? docMap.get(previewPath) : undefined;
  const previewFileName =
    previewDoc?.name ?? (previewPath ? (previewPath.split("/").pop() ?? previewPath) : "");
  const previewParentPath =
    previewDoc?.parent_path ??
    (previewPath ? previewPath.substring(0, previewPath.lastIndexOf("/")) : "");

  const previewLabel = t("detail.editor.context.previewButton");

  const toggleAttach = (path: string) => {
    const next = attachedSet.has(path)
      ? orderedPaths.filter((p) => p !== path)
      : [...new Set([...orderedPaths, path])];
    setOrderedPaths(next);
    setDocs.mutate({ skillId, paths: next, repoId: repoId ?? undefined });
  };

  const handleDragStart = (idx: number) => {
    dragItem.current = idx;
  };
  const handleDragEnter = (idx: number) => {
    dragOverItem.current = idx;
  };
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const next = [...orderedPaths];
    const dragged = next.splice(dragItem.current, 1)[0]!;
    next.splice(dragOverItem.current, 0, dragged);
    dragItem.current = null;
    dragOverItem.current = null;
    setOrderedPaths(next);
    setDocs.mutate({ skillId, paths: next, repoId: repoId ?? undefined });
  };

  return (
    <>
      <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Header: count + filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{orderedPaths.length} attached</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("detail.editor.context.filterPlaceholder")}
            aria-label={t("detail.editor.context.filterPlaceholder")}
            style={{
              marginLeft: "auto",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              padding: "4px 10px",
              fontSize: 12,
              color: "var(--text-primary)",
              outline: "none",
              width: 180,
            }}
          />
        </div>

        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          {t("detail.editor.context.orderNote")}
        </p>

        {/* Attached docs (ordered, draggable) */}
        {orderedPaths.length > 0 && (
          <div>
            {orderedPaths
              .filter((path) => {
                const doc = docMap.get(path);
                return !doc || !search || doc.name.toLowerCase().includes(search.toLowerCase());
              })
              .map((path) => {
                const doc = docMap.get(path);
                if (!doc) return null;
                // Drag indices must address the UNFILTERED source array: while a
                // search filter is active, the row's position in the filtered list
                // diverges from its position in orderedPaths, and splicing by the
                // filtered index would reorder the wrong documents.
                const srcIdx = orderedPaths.indexOf(path);
                return (
                  <DocRow
                    key={path}
                    doc={doc}
                    attached={true}
                    draggable={true}
                    onDragStart={() => handleDragStart(srcIdx)}
                    onDragEnter={() => handleDragEnter(srcIdx)}
                    onDragEnd={handleDragEnd}
                    onToggle={() => toggleAttach(path)}
                    onPreview={() => setPreviewPath(previewPath === path ? null : path)}
                    isPreviewing={previewPath === path}
                    previewLabel={previewLabel}
                  />
                );
              })}
          </div>
        )}

        {/* Unattached docs */}
        {filteredDocs
          .filter((d: DiscoveredDocument) => !attachedSet.has(d.path))
          .map((doc: DiscoveredDocument) => (
            <DocRow
              key={doc.path}
              doc={doc}
              attached={false}
              onToggle={() => toggleAttach(doc.path)}
              onPreview={() => setPreviewPath(previewPath === doc.path ? null : doc.path)}
              isPreviewing={previewPath === doc.path}
              previewLabel={previewLabel}
            />
          ))}

        {/* AC-22: Token total + untrusted note */}
        <div
          style={{
            padding: "12px 14px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            ≈ {totalTokens.toLocaleString()} tokens attached
          </div>
          <div style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
            {t("detail.editor.context.untrustedNote")}
          </div>
        </div>

        {/* AC-23: SERIALIZES AS — derived, read-only block */}
        {serializesAsText !== null && (
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text-muted)",
                letterSpacing: 0.8,
                marginBottom: 8,
                textTransform: "uppercase",
              }}
            >
              {t("detail.editor.context.serializesAs")}
            </div>
            <pre
              data-testid="serializes-as-block"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "12px 14px",
                fontSize: 12,
                color: "var(--text-secondary)",
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "monospace",
              }}
            >
              {serializesAsText}
            </pre>
          </div>
        )}

        {/* No active repo — discovery is unavailable */}
        {!repoId && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("detail.editor.context.noRepo")}
          </p>
        )}
      </div>

      {/* AC-27: Preview drawer — fixed overlay, always visible regardless of list length */}
      {previewPath && (
        <Drawer
          title={previewFileName}
          subtitle={previewParentPath}
          onClose={() => setPreviewPath(null)}
          footer={
            previewDoc ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Badge
                  color={FOLDER_KIND_COLORS[previewDoc.folder_kind] ?? "var(--text-secondary)"}
                  mono
                >
                  {previewDoc.folder_kind}
                </Badge>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("detail.editor.context.drawerTokenEstimate", {
                    count: (previewDoc.est_tokens ?? 0).toLocaleString(),
                  })}
                </span>
              </div>
            ) : undefined
          }
        >
          {previewLoading ? (
            <Skeleton height={100} />
          ) : previewData ? (
            <SafeMarkdown content={previewData.content} />
          ) : null}
        </Drawer>
      )}
    </>
  );
}
