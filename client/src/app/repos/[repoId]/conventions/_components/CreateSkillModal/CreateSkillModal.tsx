"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Modal, Button, FormField, TextInput, Icon } from "@devdigest/ui";
import { useCreateConventionSkill } from "../../../../../../lib/hooks/conventions";

interface CreateSkillModalProps {
  repoId: string;
  repoName: string;
  repoSlug: string;
  acceptedCount: number;
  onClose: () => void;
}

export function CreateSkillModal({ repoId, repoName, repoSlug, acceptedCount, onClose }: CreateSkillModalProps) {
  const router = useRouter();
  const createSkill = useCreateConventionSkill(repoId);

  const defaultName = `${repoSlug}-conventions`;
  const defaultDescription = `${acceptedCount} house convention${acceptedCount === 1 ? "" : "s"} extracted from ${repoName}`;

  const [name, setName] = React.useState(defaultName);
  const [description, setDescription] = React.useState(defaultDescription);

  const handleCreate = () => {
    createSkill.mutate(
      { name: name.trim(), description },
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
      width={560}
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
              disabled={createSkill.isPending || !name.trim()}
            >
              {createSkill.isPending ? "Creating…" : "Create skill"}
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
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
          <Icon.Sparkles size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Generates a skill body from <strong>{acceptedCount} accepted convention{acceptedCount === 1 ? "" : "s"}</strong> in{" "}
            <strong>{repoName}</strong>. You can edit the body in the skill editor after creation.
          </span>
        </div>

        <FormField label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="skill-name" />
        </FormField>

        <FormField label="Description">
          <TextInput value={description} onChange={setDescription} placeholder="What does this skill do?" />
        </FormField>
      </div>
    </Modal>
  );
}
