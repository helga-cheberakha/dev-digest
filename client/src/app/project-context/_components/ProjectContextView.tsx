/* ProjectContextView.tsx — two-pane Project Context screen (L05).
   Left: discovered document list with filter + folder-kind badges + per-row "≈ N tokens".
   Right: selected document pane — name, used-by-agents badge, token figure,
          Preview/Edit toggle (AC-28), sanitized markdown preview or plain-text editor,
          ephemerality warning (Edit mode, AC-33), save status (aria-live, AC-30),
          and attach/detach checkboxes per agent & skill.
   Empty state is shown (not an error) when no documents are found (AC-3). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Badge, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import {
  useDiscoveredDocuments,
  useDocumentPreview,
  useAgentDocuments,
  useSetAgentDocuments,
  useSkillDocuments,
  useSetSkillDocuments,
  useSaveDocument,
} from "../../../lib/hooks/project-context";
import { useAgents } from "../../../lib/hooks/agents";
import { useSkills } from "../../../lib/hooks/skills";
import { useActiveRepo } from "../../../lib/repo-context";
import { SafeMarkdown } from "@/components/SafeMarkdown";
import type { DiscoveredDocument } from "@devdigest/shared";

// ---- Folder-kind badge palette (derived from design-system tokens) ----

const FOLDER_COLORS: Record<string, { color: string; bg: string }> = {
  specs:    { color: "var(--ok)",          bg: "var(--ok-bg)" },
  docs:     { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  insights: { color: "var(--warn)",        bg: "var(--warn-bg)" },
};

function kindStyle(kind: string) {
  return FOLDER_COLORS[kind] ?? { color: "var(--text-muted)", bg: "var(--bg-elevated)" };
}

// ---- Per-agent attach/detach row (calls hooks internally) ----

function AgentAttachRow({
  agentId,
  agentName,
  docPath,
  repoId,
}: {
  agentId: string;
  agentName: string;
  docPath: string;
  repoId?: string | null;
}) {
  const t = useTranslations("project-context");
  const { data: docs } = useAgentDocuments(agentId);
  const setDocs = useSetAgentDocuments();
  const isAttached = docs?.paths.includes(docPath) ?? false;

  const toggle = () => {
    const current = docs?.paths ?? [];
    const newPaths = isAttached
      ? current.filter((p) => p !== docPath)
      : [...new Set([...current, docPath])];
    setDocs.mutate({ agentId, paths: newPaths, repoId });
  };

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        padding: "3px 0",
      }}
    >
      <input
        type="checkbox"
        checked={isAttached}
        onChange={toggle}
        aria-label={
          isAttached
            ? t("attach.detach", { name: agentName })
            : t("attach.attach", { name: agentName })
        }
      />
      <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{agentName}</span>
    </label>
  );
}

// ---- Per-skill attach/detach row ----

function SkillAttachRow({
  skillId,
  skillName,
  docPath,
  repoId,
}: {
  skillId: string;
  skillName: string;
  docPath: string;
  repoId?: string | null;
}) {
  const t = useTranslations("project-context");
  const { data: docs } = useSkillDocuments(skillId);
  const setDocs = useSetSkillDocuments();
  const isAttached = docs?.paths.includes(docPath) ?? false;

  const toggle = () => {
    const current = docs?.paths ?? [];
    const newPaths = isAttached
      ? current.filter((p) => p !== docPath)
      : [...new Set([...current, docPath])];
    setDocs.mutate({ skillId, paths: newPaths, repoId });
  };

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        padding: "3px 0",
      }}
    >
      <input
        type="checkbox"
        checked={isAttached}
        onChange={toggle}
        aria-label={
          isAttached
            ? t("attach.detach", { name: skillName })
            : t("attach.attach", { name: skillName })
        }
      />
      <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{skillName}</span>
    </label>
  );
}

// ---- Main view ----

export function ProjectContextView() {
  const t = useTranslations("project-context");
  const { repoId } = useActiveRepo();

  const { data: discovery, isLoading: listLoading } = useDiscoveredDocuments(repoId);
  const { data: agents } = useAgents();
  const { data: skills } = useSkills();

  const [filter, setFilter] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const { data: preview, isLoading: previewLoading } = useDocumentPreview(selectedPath, repoId);

  // ---- Preview / Edit toggle state ----
  // Track which path is currently being edited.
  // `isEditing` derives to true only when editingPath === the currently selected path.
  // Selecting a different document automatically resets to Preview (no useEffect needed).
  const [editingPath, setEditingPath] = React.useState<string | null>(null);
  const [editContent, setEditContent] = React.useState("");
  const isEditing = editingPath === selectedPath && selectedPath !== null;

  const saveMutation = useSaveDocument();

  // Auto-clear "Saved" status after ~2.5 s by resetting the mutation state.
  const { isSuccess: saveIsSuccess, reset: saveReset } = saveMutation;
  React.useEffect(() => {
    if (!saveIsSuccess) return;
    const id = setTimeout(saveReset, 2500);
    return () => clearTimeout(id);
  }, [saveIsSuccess, saveReset]);

  // Derive the save-status announcement text for the aria-live region.
  const saveStatusText = saveMutation.isPending
    ? t("edit.saving")
    : saveMutation.isSuccess
      ? t("edit.saved")
      : saveMutation.isError
        ? t("edit.saveFailed", {
            message: (saveMutation.error as Error)?.message ?? "Unknown error",
          })
        : "";

  const allDocs: DiscoveredDocument[] = discovery?.documents ?? [];

  const filtered: DiscoveredDocument[] = filter
    ? allDocs.filter(
        (d) =>
          d.name.toLowerCase().includes(filter.toLowerCase()) ||
          d.path.toLowerCase().includes(filter.toLowerCase()),
      )
    : allDocs;

  const selectedDoc: DiscoveredDocument | null =
    allDocs.find((d) => d.path === selectedPath) ?? null;

  const ks = selectedDoc ? kindStyle(selectedDoc.folder_kind) : { color: "", bg: "" };

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <div
        style={{
          display: "flex",
          height: "calc(100vh - 56px)",
          overflow: "hidden",
        }}
      >
        {/* ---- Left pane: document list ---- */}
        <div
          style={{
            width: 320,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          {/* Header / filter */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <h1 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>{t("title")}</h1>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0 10px",
                height: 30,
              }}
            >
              <Icon.Search
                size={12}
                style={{ color: "var(--text-muted)", flexShrink: 0 }}
                aria-hidden
              />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("filter.placeholder")}
                aria-label={t("filter.placeholder")}
                style={{
                  background: "none",
                  border: "none",
                  outline: "none",
                  fontSize: 13,
                  color: "var(--text-primary)",
                  flex: 1,
                  minWidth: 0,
                }}
              />
            </div>
          </div>

          {/* Live region: screen-reader announcement of filtered count (AC accessibility) */}
          <div
            aria-live="polite"
            aria-atomic="true"
            style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}
          >
            {filter ? t("filter.resultsCount", { count: filtered.length }) : ""}
          </div>

          {/* Truncation notice */}
          {discovery?.truncated && (
            <div
              style={{
                padding: "5px 16px",
                fontSize: 11,
                color: "var(--warn)",
                background: "var(--warn-bg)",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              {t("truncatedNote")}
            </div>
          )}

          {/* List body */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {/* Loading skeletons */}
            {listLoading && (
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <Skeleton height={40} />
                <Skeleton height={40} />
                <Skeleton height={40} />
              </div>
            )}

            {/* Empty state (AC-3) */}
            {!listLoading && allDocs.length === 0 && (
              <EmptyState
                icon="FileText"
                title={t("emptyState.title")}
                body={t("emptyState.body")}
              />
            )}

            {/* Document rows */}
            {!listLoading &&
              filtered.map((doc) => {
                const { color, bg } = kindStyle(doc.folder_kind);
                const isSelected = doc.path === selectedPath;
                return (
                  <button
                    key={doc.path}
                    onClick={() => setSelectedPath(doc.path)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                      padding: "8px 16px",
                      background: isSelected ? "var(--bg-elevated)" : "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                    }}
                    aria-pressed={isSelected}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--text-primary)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {doc.name}
                      </span>
                      <Badge color={color} bg={bg} style={{ fontSize: 10, padding: "1px 6px" }}>
                        {doc.folder_kind}
                      </Badge>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                        }}
                      >
                        {doc.parent_path}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                        {t("document.tokens", { count: doc.est_tokens })}
                      </span>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>

        {/* ---- Right pane: selected document detail ---- */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {!selectedDoc ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--text-muted)",
                fontSize: 14,
              }}
            >
              {t("preview.noSelection")}
            </div>
          ) : (
            <div style={{ padding: 24, maxWidth: 780 }}>
              {/* Document header */}
              <div style={{ marginBottom: 20 }}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}
                >
                  <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                    {selectedDoc.name}
                  </h2>
                  <Badge color={ks.color} bg={ks.bg}>
                    {selectedDoc.folder_kind}
                  </Badge>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                  {selectedDoc.path}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {/* "used by N agents" badge (AC-9) */}
                  <Badge icon="Users" color="var(--text-secondary)" bg="var(--bg-elevated)">
                    {selectedDoc.used_by_agents === 0
                      ? t("document.usedByNone")
                      : t("document.usedByAgents", { count: selectedDoc.used_by_agents })}
                  </Badge>
                  {/* "≈ N tokens" (AC-26) */}
                  <Badge mono color="var(--text-muted)" bg="var(--bg-elevated)">
                    {t("document.tokens", { count: selectedDoc.est_tokens })}
                  </Badge>
                </div>
              </div>

              {/* Preview / Edit toggle (AC-28, AC-29, AC-33) */}
              <div style={{ marginBottom: 28 }}>
                {/* Tab bar */}
                <div
                  style={{
                    display: "flex",
                    gap: 0,
                    marginBottom: 12,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <button
                    onClick={() => setEditingPath(null)}
                    aria-pressed={!isEditing}
                    style={{
                      padding: "4px 14px 8px",
                      fontSize: 12,
                      fontWeight: !isEditing ? 600 : 400,
                      color: !isEditing ? "var(--text-primary)" : "var(--text-muted)",
                      background: "none",
                      border: "none",
                      borderBottom: !isEditing
                        ? "2px solid var(--accent-text)"
                        : "2px solid transparent",
                      cursor: "pointer",
                    }}
                  >
                    {t("preview.title")}
                  </button>
                  <button
                    onClick={() => {
                      setEditContent(preview?.content ?? "");
                      setEditingPath(selectedPath);
                    }}
                    aria-pressed={isEditing}
                    style={{
                      padding: "4px 14px 8px",
                      fontSize: 12,
                      fontWeight: isEditing ? 600 : 400,
                      color: isEditing ? "var(--text-primary)" : "var(--text-muted)",
                      background: "none",
                      border: "none",
                      borderBottom: isEditing
                        ? "2px solid var(--accent-text)"
                        : "2px solid transparent",
                      cursor: "pointer",
                    }}
                  >
                    {t("edit.tabLabel")}
                  </button>
                </div>

                {/* Ephemerality warning — visible only in Edit mode (AC-33) */}
                {isEditing && (
                  <div
                    role="alert"
                    style={{
                      marginBottom: 10,
                      padding: "6px 10px",
                      fontSize: 12,
                      color: "var(--warn)",
                      background: "var(--warn-bg)",
                      borderRadius: 6,
                      border: "1px solid var(--warn)",
                    }}
                  >
                    {t("edit.warning")}
                  </div>
                )}

                {/* Preview mode — sanitized markdown (AC-21) */}
                {!isEditing && (
                  <>
                    {previewLoading && <Skeleton height={120} />}
                    {!previewLoading && preview && (
                      <div
                        style={{
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          padding: 16,
                          maxHeight: 400,
                          overflowY: "auto",
                          fontSize: 13,
                        }}
                      >
                        <SafeMarkdown content={preview.content} />
                      </div>
                    )}
                  </>
                )}

                {/* Edit mode — plain-text editor + save row (AC-28, AC-30) */}
                {isEditing && (
                  <>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      aria-label={t("edit.editorLabel")}
                      style={{
                        width: "100%",
                        minHeight: 280,
                        fontSize: 13,
                        fontFamily: "monospace",
                        padding: 12,
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--text-primary)",
                        resize: "vertical",
                        boxSizing: "border-box",
                      }}
                    />
                    {/* Save row: button + aria-live status region */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginTop: 8,
                      }}
                    >
                      <button
                        onClick={() =>
                          saveMutation.mutate({
                            path: selectedDoc.path,
                            content: editContent,
                            repoId: repoId ?? undefined,
                          })
                        }
                        disabled={saveMutation.isPending}
                        style={{
                          padding: "5px 16px",
                          fontSize: 13,
                          fontWeight: 600,
                          background: "var(--accent-text)",
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          cursor: saveMutation.isPending ? "not-allowed" : "pointer",
                          opacity: saveMutation.isPending ? 0.7 : 1,
                        }}
                      >
                        {t("edit.save")}
                      </button>
                      <span
                        aria-live="polite"
                        style={{ fontSize: 12, color: "var(--text-muted)" }}
                      >
                        {saveStatusText}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Attach / Detach control (AC-24) */}
              <div>
                <h3
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 12,
                  }}
                >
                  {t("attach.title")}
                </h3>

                {/* Agents section */}
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      marginBottom: 6,
                    }}
                  >
                    {t("attach.agentsSection")}
                  </div>
                  {(agents ?? []).length === 0 ? (
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                      {t("attach.noAgents")}
                    </span>
                  ) : (
                    (agents ?? []).map((agent) => (
                      <AgentAttachRow
                        key={agent.id}
                        agentId={agent.id}
                        agentName={agent.name}
                        docPath={selectedDoc.path}
                        repoId={repoId}
                      />
                    ))
                  )}
                </div>

                {/* Skills section */}
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      marginBottom: 6,
                    }}
                  >
                    {t("attach.skillsSection")}
                  </div>
                  {(skills ?? []).length === 0 ? (
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                      {t("attach.noSkills")}
                    </span>
                  ) : (
                    (skills ?? []).map((skill) => (
                      <SkillAttachRow
                        key={skill.id}
                        skillId={skill.id}
                        skillName={skill.name}
                        docPath={selectedDoc.path}
                        repoId={repoId}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
