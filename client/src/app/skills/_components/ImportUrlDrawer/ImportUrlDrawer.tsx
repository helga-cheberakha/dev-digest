/* ImportUrlDrawer — modal for importing a skill from a remote URL.
   Fetches a preview via the server (server-side fetch, no CORS issues),
   then creates the skill on confirm. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, FormField } from "@devdigest/ui";
import { useImportSkillPreviewUrl, useCreateSkill } from "../../../../lib/hooks/skills";

export function ImportUrlDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const importPreview = useImportSkillPreviewUrl();
  const createSkill = useCreateSkill();
  const [url, setUrl] = React.useState("");
  const [preview, setPreview] = React.useState<null | {
    name: string;
    description: string;
    type: string;
    source: string;
    body: string;
    ignored_files: string[];
    injection_detected: boolean;
  }>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleFetch = () => {
    if (!url.trim()) return;
    setError(null);
    setPreview(null);
    importPreview.mutate(
      { url: url.trim() },
      {
        onSuccess: (result) => setPreview(result),
        onError: (err) => setError(err.message),
      }
    );
  };

  const handleConfirm = () => {
    if (!preview) return;
    createSkill.mutate(
      {
        name: preview.name,
        description: preview.description,
        type: preview.type as "rubric" | "convention" | "security" | "custom",
        source: "imported_url",
        body: preview.body,
        enabled: false,
      },
      {
        onSuccess: (skill) => {
          onClose();
          router.push(`/skills/${skill.id}?tab=config`);
        },
        onError: (err) => setError(err.message),
      }
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 28,
          width: 520,
          maxHeight: "80vh",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>Import skill from URL</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 18,
            }}
          >
            ✕
          </button>
        </div>

        <FormField label="URL" hint="Must be a publicly accessible text/markdown document.">
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFetch()}
              placeholder="https://example.com/skill.md"
              style={{
                flex: 1,
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 13,
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
            <Button
              kind="secondary"
              size="sm"
              onClick={handleFetch}
              disabled={!url.trim() || importPreview.isPending}
            >
              {importPreview.isPending ? "Fetching…" : "Fetch"}
            </Button>
          </div>
        </FormField>

        {error && <p style={{ color: "var(--error-text)", fontSize: 13 }}>{error}</p>}

        {preview && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                Extracted name
              </div>
              <div style={{ fontWeight: 600 }}>{preview.name}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Type</div>
              <div>{preview.type}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                Body preview (first 300 chars)
              </div>
              <pre
                style={{
                  fontSize: 12,
                  background: "var(--bg-hover)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  overflow: "auto",
                  maxHeight: 120,
                  color: "var(--text-secondary)",
                }}
              >
                {preview.body.slice(0, 300)}
                {preview.body.length > 300 ? "…" : ""}
              </pre>
            </div>

            {preview.injection_detected ? (
              <div
                style={{
                  background: "var(--error-bg, rgba(239,68,68,0.08))",
                  border: "1px solid var(--error-border, rgba(239,68,68,0.3))",
                  borderRadius: 6,
                  padding: "10px 14px",
                  fontSize: 12,
                  color: "var(--error-text)",
                }}
              >
                <strong>Injection patterns detected.</strong> This skill will be permanently
                blocked from enabling. It cannot be injected into AI review prompts.
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "var(--warning-text)" }}>
                ⚠ This skill will be imported as <strong>disabled</strong>. Vet its content
                before enabling it.
              </p>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <Button kind="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            kind="primary"
            size="sm"
            onClick={handleConfirm}
            disabled={!preview || createSkill.isPending}
          >
            {createSkill.isPending ? "Importing…" : "Confirm import"}
          </Button>
        </div>
      </div>
    </div>
  );
}
