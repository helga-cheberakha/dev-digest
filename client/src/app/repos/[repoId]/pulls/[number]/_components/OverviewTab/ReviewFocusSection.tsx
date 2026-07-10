"use client";

import React from "react";
import { SectionLabel, Badge, Icon } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import { parseFileRef, type FileRefTarget } from "@/lib/parseFileRef";

const MAX_FILE_REFS = 6;

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-elevated)",
  padding: 18,
};

const fileRefBtnStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 12,
  background: "none",
  border: "none",
  padding: "0 2px",
  cursor: "pointer",
  color: "var(--text-secondary)",
  display: "inline",
};

export interface ReviewFocusSectionProps {
  items: ReviewFocusItem[];
  onOpenFile?: (ref: FileRefTarget) => void;
}

export function ReviewFocusSection({ items, onOpenFile }: ReviewFocusSectionProps) {
  const t = useTranslations("prBrief");
  const ChevronRight = Icon.ChevronRight;

  return (
    <section style={cardStyle}>
      <SectionLabel icon="ListChecks" right={<Badge>{items.length}</Badge>}>
        {t("reviewFocus")}
      </SectionLabel>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          {t("reviewFocusEmpty")}
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {items.map((item, i) => (
            <li
              key={`${i}-${item.label}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                fontSize: 13,
                marginBottom: i < items.length - 1 ? 6 : 0,
              }}
            >
              <ChevronRight
                size={12}
                style={{ color: "var(--text-muted)", marginTop: 2, flexShrink: 0 }}
              />
              <span>
                {item.file_refs.slice(0, MAX_FILE_REFS).map((ref) => (
                  <button
                    key={ref}
                    style={fileRefBtnStyle}
                    onClick={() => onOpenFile?.(parseFileRef(ref))}
                  >
                    {ref}
                  </button>
                ))}
                {" — "}
                <span>{item.label}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
