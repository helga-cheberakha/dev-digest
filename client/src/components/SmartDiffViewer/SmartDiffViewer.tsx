"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { SmartDiff, SmartDiffRole, SmartDiffFile } from "@devdigest/shared";
import type { FindingRecord } from "@devdigest/shared";

// ---- Role metadata ---------------------------------------------------------

const ROLE_META: Record<
  SmartDiffRole,
  { label: string; desc: string; dotColor: string; defaultOpen: boolean }
> = {
  core: {
    label: "Core logic",
    desc: "The substance of the change — review closely",
    dotColor: "var(--crit)",
    defaultOpen: true,
  },
  wiring: {
    label: "Wiring",
    desc: "Hooks the core into the app",
    dotColor: "var(--warn)",
    defaultOpen: true,
  },
  boilerplate: {
    label: "Boilerplate",
    desc: "Generated / mechanical — skim",
    dotColor: "var(--text-muted)",
    defaultOpen: false,
  },
};

// ---- Severity badge counts --------------------------------------------------

type SeverityCounts = { critical: number; high: number; medium: number; low: number };

function countSeverities(findings: FindingRecord[]): SeverityCounts {
  return findings.reduce<SeverityCounts>(
    (acc, f) => {
      const s = f.severity.toLowerCase();
      if (s === "critical") acc.critical++;
      else if (s === "high") acc.high++;
      else if (s === "medium") acc.medium++;
      else acc.low++;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  );
}

// ---- Finding badge ---------------------------------------------------------

interface FindingBadgeProps {
  findings: FindingRecord[];
  onNavigate: (id: string) => void;
}

function FindingBadge({ findings, onNavigate }: FindingBadgeProps) {
  if (findings.length === 0) return null;
  const counts = countSeverities(findings);
  const first = findings[0];

  const blockers = counts.critical + counts.high;
  const warnings = counts.medium;

  return (
    <span style={s.badgeRow}>
      {blockers > 0 && (
        <button
          style={{ ...s.badge, ...s.badgeCrit }}
          onClick={(e) => {
            e.stopPropagation();
            if (first) onNavigate(first.id);
          }}
          title={`${blockers} blocker${blockers !== 1 ? "s" : ""} — click to view`}
        >
          <Icon.XCircle size={11} />
          {blockers} {blockers === 1 ? "blocker" : "blockers"}
        </button>
      )}
      {warnings > 0 && (
        <button
          style={{ ...s.badge, ...s.badgeWarn }}
          onClick={(e) => {
            e.stopPropagation();
            const first_warn = findings.find(
              (f) => f.severity.toLowerCase() === "medium",
            );
            if (first_warn) onNavigate(first_warn.id);
          }}
          title={`${warnings} warning${warnings !== 1 ? "s" : ""} — click to view`}
        >
          <Icon.AlertTriangle size={11} />
          {warnings} {warnings === 1 ? "warning" : "warnings"}
        </button>
      )}
      {counts.low > 0 && blockers === 0 && warnings === 0 && (
        <button
          style={{ ...s.badge, ...s.badgeInfo }}
          onClick={(e) => {
            e.stopPropagation();
            if (first) onNavigate(first.id);
          }}
          title={`${counts.low} note${counts.low !== 1 ? "s" : ""} — click to view`}
        >
          <Icon.Info size={11} />
          {counts.low}
        </button>
      )}
    </span>
  );
}

// ---- File row --------------------------------------------------------------

interface FileRowProps {
  file: SmartDiffFile;
  findings: FindingRecord[];
  onNavigateToFinding: (id: string) => void;
}

function FileRow({ file, findings, onNavigateToFinding }: FileRowProps) {
  const parts = file.path.split("/");
  const filename = parts.pop() ?? file.path;
  const dir = parts.join("/");

  return (
    <div style={s.fileRow}>
      <Icon.FileText size={13} style={s.fileIcon} />
      <span style={s.filePath}>
        {dir && <span style={s.fileDir}>{dir}/</span>}
        <span style={s.fileName}>{filename}</span>
      </span>
      <FindingBadge findings={findings} onNavigate={onNavigateToFinding} />
      <span style={s.diffStat}>
        {file.additions > 0 && (
          <span style={s.adds}>+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span style={s.dels}>−{file.deletions}</span>
        )}
      </span>
    </div>
  );
}

// ---- Group section ---------------------------------------------------------

interface GroupSectionProps {
  role: SmartDiffRole;
  files: SmartDiffFile[];
  findingsByFile: Map<string, FindingRecord[]>;
  onNavigateToFinding: (id: string) => void;
}

function GroupSection({ role, files, findingsByFile, onNavigateToFinding }: GroupSectionProps) {
  const meta = ROLE_META[role];
  const [open, setOpen] = React.useState(meta.defaultOpen);

  const totalFindings = files.reduce(
    (sum, f) => sum + (findingsByFile.get(f.path)?.length ?? 0),
    0,
  );

  return (
    <div style={s.group}>
      <button style={s.groupHeader} onClick={() => setOpen((v) => !v)}>
        <span style={{ ...s.roleDot, background: meta.dotColor }} />
        <span style={s.roleLabel}>{meta.label}</span>
        <span style={s.roleDesc}>{meta.desc}</span>
        <span style={s.groupRight}>
          {totalFindings > 0 && (
            <span style={s.findingCount}>
              <Icon.AlertOctagon size={11} />
              {totalFindings}
            </span>
          )}
          <span style={s.fileCount}>{files.length} {files.length === 1 ? "file" : "files"}</span>
          {open ? (
            <Icon.ChevronDown size={14} style={s.chevron} />
          ) : (
            <Icon.ChevronRight size={14} style={s.chevron} />
          )}
        </span>
      </button>

      {open && (
        <div style={s.fileList}>
          {files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              findings={findingsByFile.get(file.path) ?? []}
              onNavigateToFinding={onNavigateToFinding}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main viewer -----------------------------------------------------------

interface SmartDiffViewerProps {
  smartDiff: SmartDiff;
  /** All findings from the latest review run — used to decorate files with badges. */
  allFindings: FindingRecord[];
  /** Navigate to a specific finding (switches to Findings tab + scrolls). */
  onNavigateToFinding: (findingId: string) => void;
}

export function SmartDiffViewer({
  smartDiff,
  allFindings,
  onNavigateToFinding,
}: SmartDiffViewerProps) {
  const findingsByFile = React.useMemo(() => {
    const map = new Map<string, FindingRecord[]>();
    for (const f of allFindings) {
      let arr = map.get(f.file);
      if (!arr) {
        arr = [];
        map.set(f.file, arr);
      }
      arr.push(f);
    }
    return map;
  }, [allFindings]);

  const totalFiles = smartDiff.groups.reduce((s, g) => s + g.files.length, 0);
  const { too_big, total_lines } = smartDiff.split_suggestion;

  return (
    <div style={s.root}>
      <div style={s.subHeader}>
        <span style={s.statLine}>
          {totalFiles} {totalFiles === 1 ? "file" : "files"} · {total_lines} lines changed
        </span>
        {too_big && (
          <span style={s.tooBig}>
            <Icon.AlertTriangle size={12} />
            Large PR — consider splitting
          </span>
        )}
      </div>

      {smartDiff.groups.map((group) => (
        <GroupSection
          key={group.role}
          role={group.role}
          files={group.files}
          findingsByFile={findingsByFile}
          onNavigateToFinding={onNavigateToFinding}
        />
      ))}
    </div>
  );
}

// ---- Styles ----------------------------------------------------------------

const s = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  subHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "6px 0 10px",
    fontSize: 12,
    color: "var(--text-muted)",
  },
  statLine: {
    fontVariantNumeric: "tabular-nums",
  },
  tooBig: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: "var(--warn)",
    fontWeight: 500,
  },
  group: {
    borderRadius: 6,
    border: "1px solid var(--border)",
    overflow: "hidden",
    marginBottom: 4,
  },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 12px",
    background: "var(--surface-2)",
    border: "none",
    cursor: "pointer",
    textAlign: "left" as const,
    fontSize: 13,
    color: "var(--text)",
  },
  roleDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  roleLabel: {
    fontWeight: 600,
    flexShrink: 0,
  },
  roleDesc: {
    color: "var(--text-muted)",
    fontSize: 12,
    flexGrow: 1,
  },
  groupRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
    flexShrink: 0,
  },
  findingCount: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    color: "var(--crit)",
    fontWeight: 600,
    fontSize: 12,
  },
  fileCount: {
    color: "var(--text-muted)",
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  },
  chevron: {
    color: "var(--text-muted)",
    flexShrink: 0,
  },
  fileList: {
    display: "flex",
    flexDirection: "column" as const,
  },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 13,
  },
  fileIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
  },
  filePath: {
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
  },
  fileDir: {
    color: "var(--text-muted)",
  },
  fileName: {
    color: "var(--text)",
    fontWeight: 500,
  },
  badgeRow: {
    display: "inline-flex",
    gap: 4,
    flexShrink: 0,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "2px 6px",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.4,
  },
  badgeCrit: {
    background: "var(--crit-bg)",
    color: "var(--crit)",
  },
  badgeWarn: {
    background: "var(--warn-bg)",
    color: "var(--warn)",
  },
  badgeInfo: {
    background: "var(--ok-bg)",
    color: "var(--ok)",
  },
  diffStat: {
    display: "flex",
    gap: 4,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  adds: {
    color: "var(--code-add-text)",
  },
  dels: {
    color: "var(--code-del-text)",
  },
};
