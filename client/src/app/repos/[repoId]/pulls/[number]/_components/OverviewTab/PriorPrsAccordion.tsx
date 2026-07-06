"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import type { PriorPr } from "@devdigest/shared";

/** Returns a human-readable relative date string for an ISO timestamp. */
export function relativeDate(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays > 365) return `${Math.floor(diffDays / 365)}y ago`;
  if (diffDays > 30) return `${Math.floor(diffDays / 30)}mo ago`;
  if (diffDays > 0) return `${diffDays}d ago`;
  const diffHours = Math.floor(diffMs / 3_600_000);
  if (diffHours > 0) return `${diffHours}h ago`;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins > 0) return `${diffMins}m ago`;
  return "just now";
}

interface PriorPrsAccordionProps {
  priorPrs: PriorPr[];
}

export function PriorPrsAccordion({ priorPrs }: PriorPrsAccordionProps) {
  const t = useTranslations("blast");
  const [open, setOpen] = useState(false);

  if (priorPrs.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 12,
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            flex: 1,
          }}
        >
          {t("priorPrs.label")}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 12,
            background: "var(--bg-hover)",
            color: "var(--text-muted)",
          }}
        >
          {t("priorPrs.count", { count: priorPrs.length })}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {priorPrs.map((pr) => (
            <div
              key={pr.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 14px",
                borderBottom: "1px solid var(--border)",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  color: "var(--text-muted)",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                #{pr.number}
              </span>
              <span
                style={{
                  color: "var(--text-secondary)",
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {pr.title}
              </span>
              <span
                style={{
                  color: "var(--text-muted)",
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                {relativeDate(pr.opened_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
