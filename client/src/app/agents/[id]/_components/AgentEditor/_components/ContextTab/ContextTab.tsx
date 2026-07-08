/* ContextTab — Agent editor tab for attaching project context documents.
   Shows discovered .md files (specs/docs/insights) with drag-reorder, checkbox
   attach/detach, folder-kind badge, and a dismissible preview drawer.
   AC-20, AC-22, AC-27. */
"use client";
import React from "react";
import { Badge, Drawer, Skeleton } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { DiscoveredDocument } from "@devdigest/shared";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import {
  useAgentDocuments,
  useSetAgentDocuments,
  useDiscoveredDocuments,
  useDocumentPreview,
} from "../../../../../../../lib/hooks/project-context";
import { useActiveRepo } from "../../../../../../../lib/repo-context";

const FOLDER_KIND_COLOR: Record<string, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

export function ContextTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const { repoId } = useActiveRepo();

  const { data: attachedData, isLoading: attachedLoading } = useAgentDocuments(agentId);
  const { data: discovery, isLoading: discoveryLoading } = useDiscoveredDocuments(repoId);
  const setDocuments = useSetAgentDocuments();

  const [orderedPaths, setOrderedPaths] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  const dragItem = React.useRef<number | null>(null);
  const dragOverItem = React.useRef<number | null>(null);

  // Sync ordered paths from server on load / invalidation
  React.useEffect(() => {
    if (attachedData) {
      setOrderedPaths(attachedData.paths);
    }
  }, [attachedData]);

  const { data: previewData, isLoading: previewLoading } = useDocumentPreview(previewPath, repoId);

  if (attachedLoading || discoveryLoading) return <Skeleton height={200} />;

  const allDocs = discovery?.documents ?? [];
  const docMap = new Map(allDocs.map((d: DiscoveredDocument) => [d.path, d]));
  const attachedSet = new Set(orderedPaths);

  // Token total derived from current selection (AC-22)
  const tokenTotal = orderedPaths.reduce((sum, path) => {
    return sum + (docMap.get(path)?.est_tokens ?? 0);
  }, 0);

  const previewDoc = previewPath ? docMap.get(previewPath) : undefined;

  const filteredDocs = allDocs.filter(
    (d: DiscoveredDocument) =>
      !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.parent_path.toLowerCase().includes(search.toLowerCase()),
  );

  const toggle = (path: string) => {
    const next = attachedSet.has(path)
      ? orderedPaths.filter((p) => p !== path)
      : [...new Set([...orderedPaths, path])];
    setOrderedPaths(next);
    setDocuments.mutate({ agentId, paths: next, repoId: repoId ?? undefined });
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
    setDocuments.mutate({ agentId, paths: next, repoId: repoId ?? undefined });
  };

  const handlePreview = (path: string) => {
    setPreviewPath(previewPath === path ? null : path);
  };

  const previewFileName =
    previewDoc?.name ?? (previewPath ? (previewPath.split("/").pop() ?? previewPath) : "");
  const previewParentPath =
    previewDoc?.parent_path ??
    (previewPath ? previewPath.substring(0, previewPath.lastIndexOf("/")) : "");

  return (
    <>
    <div style={{ maxWidth: 580 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {t("context.attachedCount", { count: orderedPaths.length })}
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("context.filterPlaceholder")}
          aria-label={t("context.filterPlaceholder")}
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
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
        {t("context.orderHint")}
      </p>

      {/* ── Attached docs (ordered, draggable) ── */}
      {orderedPaths.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {orderedPaths.map((path, idx) => {
            const doc = docMap.get(path);
            const name = doc?.name ?? path.split("/").pop() ?? path;
            const parentPath = doc?.parent_path ?? path.substring(0, path.lastIndexOf("/"));
            const folderKind = doc?.folder_kind ?? "docs";
            return (
              <div
                key={path}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragEnter={() => handleDragEnter(idx)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 6,
                  marginBottom: 4,
                  border: "1px solid var(--border)",
                  background: "var(--bg-surface)",
                  cursor: "grab",
                }}
              >
                <span style={{ color: "var(--text-muted)", cursor: "grab", flexShrink: 0, fontSize: 14 }}>
                  ⠿
                </span>
                <input
                  type="checkbox"
                  checked
                  onChange={() => toggle(path)}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {parentPath}
                </span>
                <Badge color={FOLDER_KIND_COLOR[folderKind] ?? "var(--text-secondary)"} mono>
                  {folderKind}
                </Badge>
                <button
                  onClick={() => handlePreview(path)}
                  aria-label={`${t("context.previewButton")} ${name}`}
                  style={{
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "2px 7px",
                    fontSize: 11,
                    cursor: "pointer",
                    color: "var(--text-secondary)",
                    flexShrink: 0,
                  }}
                >
                  {t("context.previewButton")}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Available (unattached) docs ── */}
      {filteredDocs
        .filter((d: DiscoveredDocument) => !attachedSet.has(d.path))
        .map((doc: DiscoveredDocument) => (
          <div
            key={doc.path}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 6,
              marginBottom: 4,
              border: "1px solid var(--border)",
              opacity: 0.7,
            }}
          >
            <div style={{ width: 14, flexShrink: 0 }} />
            <input
              type="checkbox"
              checked={false}
              onChange={() => toggle(doc.path)}
              style={{ cursor: "pointer", flexShrink: 0 }}
            />
            <span style={{ fontSize: 13 }}>{doc.name}</span>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {doc.parent_path}
            </span>
            <Badge color={FOLDER_KIND_COLOR[doc.folder_kind] ?? "var(--text-secondary)"} mono>
              {doc.folder_kind}
            </Badge>
            <button
              onClick={() => handlePreview(doc.path)}
              aria-label={`${t("context.previewButton")} ${doc.name}`}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "2px 7px",
                fontSize: 11,
                cursor: "pointer",
                color: "var(--text-secondary)",
                flexShrink: 0,
              }}
            >
              {t("context.previewButton")}
            </button>
          </div>
        ))}

      {/* ── Footer: token total + untrusted note (AC-22) ── */}
      <div
        style={{
          marginTop: 20,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        <span style={{ fontWeight: 600 }}>
          {t("context.tokenTotal", { count: tokenTotal.toLocaleString() })}
        </span>
        {" · "}
        <span>{t("context.untrustedNote")}</span>
      </div>
    </div>

    {/* ── AC-27 Preview drawer — fixed overlay, always visible ── */}
    {previewPath && (
      <Drawer
        title={previewFileName}
        subtitle={previewParentPath}
        onClose={() => setPreviewPath(null)}
        footer={
          previewDoc ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Badge
                color={FOLDER_KIND_COLOR[previewDoc.folder_kind] ?? "var(--text-secondary)"}
                mono
              >
                {previewDoc.folder_kind}
              </Badge>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("context.drawerTokenEstimate", {
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
