"use client";

import React from "react";
import { Button, Icon } from "@devdigest/ui";
import type { Convention } from "@devdigest/shared";
import type { UpdateConventionInput } from "../../../../../../lib/hooks/conventions";

interface ConventionCardProps {
  convention: Convention;
  onUpdate: (id: string, patch: UpdateConventionInput) => void;
  isUpdating?: boolean;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", width: 76 }}>Confidence</span>
      <div
        style={{
          flex: 1,
          height: 4,
          background: "var(--border)",
          borderRadius: 2,
          overflow: "hidden",
          maxWidth: 120,
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{pct}%</span>
    </div>
  );
}

export function ConventionCard({ convention, onUpdate, isUpdating }: ConventionCardProps) {
  const [editingRule, setEditingRule] = React.useState(false);
  const [ruleText, setRuleText] = React.useState(convention.rule);
  const isAccepted = convention.status === "accepted";
  const fileRef = `${convention.file_path}:${convention.line_start}-${convention.line_end}`;

  const handleRuleBlur = () => {
    setEditingRule(false);
    if (ruleText.trim() && ruleText !== convention.rule) {
      onUpdate(convention.id, { rule: ruleText.trim() });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(fileRef);
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        background: "var(--bg-card)",
        border: `1px solid ${isAccepted ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 8,
        padding: "16px 20px",
        marginBottom: 12,
      }}
    >
      {/* left: content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* rule title — editable */}
        {editingRule ? (
          <textarea
            value={ruleText}
            onChange={(e) => setRuleText(e.target.value)}
            onBlur={handleRuleBlur}
            autoFocus
            style={{
              width: "100%",
              fontWeight: 600,
              fontStyle: "italic",
              fontSize: 14,
              background: "var(--bg-surface)",
              border: "1px solid var(--accent)",
              borderRadius: 4,
              padding: "4px 8px",
              color: "var(--text-primary)",
              resize: "vertical",
              marginBottom: 8,
            }}
          />
        ) : (
          <div
            onClick={() => setEditingRule(true)}
            style={{
              fontWeight: 600,
              fontStyle: "italic",
              fontSize: 14,
              color: "var(--text-primary)",
              marginBottom: 8,
              cursor: "text",
            }}
          >
            {convention.rule}
          </div>
        )}

        {/* file reference */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 8,
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          <span
            style={{
              background: "var(--bg-surface)",
              borderRadius: 4,
              padding: "2px 8px",
              fontFamily: "monospace",
            }}
          >
            {fileRef}
          </span>
          <button
            onClick={handleCopy}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 2,
              color: "var(--text-muted)",
              display: "flex",
            }}
            title="Copy file reference"
          >
            <Icon.Copy size={12} />
          </button>
        </div>

        {/* code snippet */}
        {convention.snippet && (
          <pre
            style={{
              background: "var(--bg-surface)",
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 12,
              fontFamily: "monospace",
              color: "var(--text-primary)",
              overflowX: "auto",
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {convention.snippet}
          </pre>
        )}

        <ConfidenceBar value={convention.confidence} />
      </div>

      {/* right: actions */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flexShrink: 0,
          paddingTop: 2,
        }}
      >
        <Button
          kind={isAccepted ? "primary" : "secondary"}
          size="sm"
          icon="Check"
          disabled={isUpdating}
          onClick={() => onUpdate(convention.id, { status: "accepted" })}
        >
          {isAccepted ? "Accepted" : "Accept"}
        </Button>
        <button
          onClick={() => onUpdate(convention.id, { status: "rejected" })}
          disabled={isUpdating}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
          }}
        >
          <Icon.X size={12} />
          Reject
        </button>
      </div>
    </div>
  );
}
