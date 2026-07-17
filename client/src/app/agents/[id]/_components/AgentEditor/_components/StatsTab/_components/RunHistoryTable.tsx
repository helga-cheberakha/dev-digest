"use client";

/**
 * RunHistoryTable — paginated table of per-agent run history rows.
 *
 * Pure presentational: all data and callbacks arrive as props (no useQuery,
 * no internal pagination state). T6 drives the page/limit/total/onPageChange.
 *
 * Security notes:
 *  - `pr_title` is untrusted GitHub content: rendered as escaped React text,
 *    NEVER via dangerouslySetInnerHTML.
 *  - PR link href is built only from `pr_repo_id`/`pr_number` (internal IDs),
 *    never from pr_title or other user-supplied fields.
 *
 * Accessibility:
 *  - `findings_count === 0` renders "0" (not "—"): zero is a real value.
 *  - "View trace" is disabled (button[disabled]) when has_trace === false so
 *    the action is clearly non-actionable without disappearing from the row.
 *  - Pagination buttons carry aria-label for screen readers.
 *
 * Styling: inline styles with var(--*) tokens, matching StatsTab.tsx convention.
 */

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { RunHistoryRow } from "@devdigest/shared";
import { Badge } from "@devdigest/ui";
import { formatTimeAgo } from "@/lib/time-ago";
import { formatCost } from "@/lib/cost";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const headerStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.05em",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  textAlign: "left",
};

const cellStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "var(--text-secondary)",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const mutedSpan = (
  <span style={{ color: "var(--text-muted)" }}>—</span>
);

function SourceBadge({ source }: { source: "local" | "ci" }) {
  return source === "ci" ? (
    <Badge color="var(--accent)" bg="var(--bg-elevated)">
      CI
    </Badge>
  ) : (
    <Badge color="var(--text-secondary)" bg="var(--bg-hover)">
      LOCAL
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RunHistoryTable({
  rows,
  onViewTrace,
  page,
  limit,
  total,
  onPageChange,
}: {
  rows: RunHistoryRow[];
  onViewTrace: (row: RunHistoryRow) => void;
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const t = useTranslations("agents");
  const totalPages = Math.ceil(total / limit) || 1;
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  if (rows.length === 0 && total === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
        {t("stats.runHistoryTable.emptyState")}
      </p>
    );
  }

  return (
    <div>
      {/* ── Table ── */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={headerStyle}>{t("stats.runHistoryTable.colTimestamp")}</th>
              <th style={headerStyle}>{t("stats.runHistoryTable.colPr")}</th>
              <th style={headerStyle}>{t("stats.runHistoryTable.colTokens")}</th>
              <th style={headerStyle}>{t("stats.runHistoryTable.colCost")}</th>
              <th style={{ ...headerStyle, textAlign: "right" }}>{t("stats.runHistoryTable.colFindings")}</th>
              <th style={headerStyle}>{t("stats.runHistoryTable.colSource")}</th>
              <th style={headerStyle} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.run_id}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                {/* Timestamp — relative time with full ISO in title tooltip */}
                <td style={cellStyle} title={row.ran_at}>
                  {formatTimeAgo(row.ran_at)}
                </td>

                {/* PR — link only when both pr_repo_id and pr_number are present */}
                <td style={{ ...cellStyle, maxWidth: 200 }}>
                  {row.pr_number != null && row.pr_repo_id != null ? (
                    <Link
                      href={`/repos/${row.pr_repo_id}/pulls/${row.pr_number}`}
                      style={{
                        color: "var(--accent)",
                        textDecoration: "none",
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {/* pr_title: untrusted GitHub text — escaped React text only */}
                      {row.pr_title ?? `#${row.pr_number}`}
                    </Link>
                  ) : (
                    mutedSpan
                  )}
                </td>

                {/* Tokens */}
                <td style={cellStyle} className="tnum mono">
                  {row.tokens_in != null || row.tokens_out != null
                    ? `${row.tokens_in ?? "—"} / ${row.tokens_out ?? "—"}`
                    : "—"}
                </td>

                {/* Cost */}
                <td style={cellStyle} className="tnum">
                  {formatCost(row.cost_usd)}
                </td>

                {/* Findings — 0 is a real value, render "0" not "—" */}
                <td
                  style={{ ...cellStyle, textAlign: "right" }}
                  className="tnum"
                >
                  {row.findings_count != null
                    ? String(row.findings_count)
                    : "—"}
                </td>

                {/* Source badge */}
                <td style={cellStyle}>
                  <SourceBadge source={row.source} />
                </td>

                {/* View trace — disabled when no trace exists */}
                <td style={cellStyle}>
                  <button
                    onClick={row.has_trace ? () => onViewTrace(row) : undefined}
                    disabled={!row.has_trace}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 5,
                      border: "1px solid var(--border)",
                      background: row.has_trace
                        ? "var(--bg-elevated)"
                        : "transparent",
                      color: row.has_trace
                        ? "var(--accent)"
                        : "var(--text-muted)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: row.has_trace ? "pointer" : "not-allowed",
                      opacity: row.has_trace ? 1 : 0.5,
                      whiteSpace: "nowrap",
                    }}
                    aria-label={
                      row.has_trace
                        ? t("stats.runHistoryTable.viewTraceFor", { runId: row.run_id })
                        : t("stats.runHistoryTable.noTrace")
                    }
                  >
                    {t("stats.runHistoryTable.viewTrace")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 16,
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPrev}
            aria-label="Previous page"
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              color: hasPrev ? "var(--text-primary)" : "var(--text-muted)",
              fontSize: 12,
              fontWeight: 600,
              cursor: hasPrev ? "pointer" : "not-allowed",
              opacity: hasPrev ? 1 : 0.5,
            }}
          >
            {t("stats.runHistoryTable.prevPage")}
          </button>

          <span
            style={{ fontSize: 12, color: "var(--text-muted)" }}
            className="tnum"
          >
            {t("stats.runHistoryTable.pageOf", { page, totalPages })}
          </span>

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNext}
            aria-label="Next page"
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              color: hasNext ? "var(--text-primary)" : "var(--text-muted)",
              fontSize: 12,
              fontWeight: 600,
              cursor: hasNext ? "pointer" : "not-allowed",
              opacity: hasNext ? 1 : 0.5,
            }}
          >
            {t("stats.runHistoryTable.nextPage")}
          </button>
        </div>
      )}
    </div>
  );
}
