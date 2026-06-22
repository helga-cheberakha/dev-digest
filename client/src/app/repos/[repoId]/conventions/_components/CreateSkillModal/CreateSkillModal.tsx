"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Modal, Button, FormField, TextInput, Textarea, Toggle, Icon } from "@devdigest/ui";
import type { Convention } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";

interface CreateSkillModalProps {
  repoName: string;
  repoSlug: string;
  accepted: Convention[];
  onClose: () => void;
}

function buildSkillBody(repoName: string, accepted: Convention[]): string {
  const slug = repoName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  let body = `# ${slug}-conventions\n\nHouse conventions for \`${repoName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.\n`;
  for (const c of accepted) {
    const sectionSlug = c.category.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'general';
    body += `\n## ${sectionSlug}\n${c.rule}\n\nDetected in \`${c.file_path}:${c.line_start}-${c.line_end}\`:\n\`\`\`\n${c.snippet}\n\`\`\`\n`;
  }
  return body;
}

export function CreateSkillModal({ repoName, repoSlug, accepted, onClose }: CreateSkillModalProps) {
  const router = useRouter();
  const createSkill = useCreateSkill();

  const defaultName = `${repoSlug}-conventions`;
  const defaultDescription = `${accepted.length} house convention${accepted.length === 1 ? '' : 's'} extracted from ${repoName}`;

  const [name, setName] = React.useState(defaultName);
  const [description, setDescription] = React.useState(defaultDescription);
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState(() => buildSkillBody(repoName, accepted));

  const handleCreate = () => {
    createSkill.mutate(
      { name, description, type: "convention", source: "extracted", body, enabled },
      {
        onSuccess: (skill) => {
          router.push(`/skills/${skill.id}?tab=config`);
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      width={760}
      title="Create skill from conventions"
      subtitle={defaultName}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            <Icon.GitCommit size={12} />
            Saved as v1 · added to Skills Lab
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button kind="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              kind="primary"
              size="sm"
              icon="Sparkles"
              onClick={handleCreate}
              disabled={createSkill.isPending || !name.trim() || !body.trim()}
            >
              {createSkill.isPending ? "Creating…" : "Create skill"}
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* info banner */}
        <div
          style={{
            background: "rgba(59,130,246,0.1)",
            border: "1px solid rgba(59,130,246,0.3)",
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--text-secondary)",
            display: "flex",
            gap: 8,
          }}
        >
          <Icon.Edit size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Merged from <strong>{accepted.length} accepted convention{accepted.length === 1 ? '' : 's'}</strong> in{" "}
            <strong>{repoName}</strong>. Everything below is editable before you save.
          </span>
        </div>

        <FormField label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="skill-name" />
        </FormField>

        <FormField label="Description">
          <TextInput value={description} onChange={setDescription} placeholder="What does this skill do?" />
        </FormField>

        <div style={{ display: "flex", gap: 16 }}>
          {/* Type (fixed to convention) */}
          <div style={{ flex: 1 }}>
          <FormField label="Type">
            <div
              style={{
                height: 36,
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0 12px",
                display: "flex",
                alignItems: "center",
                fontSize: 13,
                color: "var(--text-secondary)",
                background: "var(--bg-surface)",
              }}
            >
              convention
            </div>
          </FormField>
          </div>

          {/* Enabled toggle */}
          <FormField label="Enabled">
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 6 }}>
              <Toggle on={enabled} onChange={setEnabled} />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Whether this block is added to agents' prompts.
              </span>
            </div>
          </FormField>
        </div>

        <FormField label="Skill body" required>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {/* header bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                background: "var(--bg-surface)",
                borderBottom: "1px solid var(--border)",
                fontSize: 12,
              }}
            >
              <Icon.FileText size={12} style={{ color: "var(--text-muted)" }} />
              <span style={{ color: "var(--text-secondary)", fontFamily: "monospace" }}>
                {name || defaultName}.md
              </span>
              <span
                style={{
                  marginLeft: 4,
                  color: "var(--text-muted)",
                  background: "var(--bg-input)",
                  padding: "1px 6px",
                  borderRadius: 3,
                  fontSize: 11,
                }}
              >
                unsaved
              </span>
            </div>
            <Textarea value={body} onChange={setBody} rows={14} mono />
          </div>
        </FormField>
      </div>
    </Modal>
  );
}
