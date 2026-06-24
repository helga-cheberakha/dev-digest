"use client";

import React from "react";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { useRepos } from "../../../../../../lib/hooks/core";
import {
  useConventions,
  useExtractConventions,
  useUpdateConvention,
} from "../../../../../../lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard/ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal/CreateSkillModal";

export function ConventionsView({ repoId }: { repoId: string }) {
  const { data: repos } = useRepos();
  const repo = repos?.find((r) => r.id === repoId);
  const repoName = repo?.name ?? "…";
  const repoSlug = repoName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const { data: conventions, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);

  const [showModal, setShowModal] = React.useState(false);
  const [lastScanAt, setLastScanAt] = React.useState<string | null>(null);
  const [sampleCount, setSampleCount] = React.useState<number | null>(null);
  const [extractError, setExtractError] = React.useState<string | null>(null);

  const visible = (conventions ?? []).filter((c) => c.status !== "rejected");
  const accepted = (conventions ?? []).filter((c) => c.status === "accepted");
  const total = visible.length;

  const handleRescan = () => {
    setExtractError(null);
    extract.mutate(undefined, {
      onSuccess: (result) => {
        setLastScanAt(result.scanned_at);
        setSampleCount(result.sample_count);
        if (result.error) setExtractError(result.error);
      },
    });
  };

  const handleDeselectAll = () => {
    accepted.forEach((c) => update.mutate({ id: c.id, patch: { status: "pending" } }));
  };

  const scanSubtitle = sampleCount != null
    ? `Detected from ${sampleCount} sample files`
    : conventions && conventions.length > 0
      ? `${conventions.length} convention${conventions.length === 1 ? "" : "s"} found`
      : null;

  return (
    <AppShell crumb={[{ label: "Skills Lab" }, { label: "Conventions" }]}>
      {showModal && (
        <CreateSkillModal
          repoId={repoId}
          repoName={repoName}
          repoSlug={repoSlug}
          acceptedCount={accepted.length}
          onClose={() => setShowModal(false)}
        />
      )}

      <div style={{ padding: "24px 32px", maxWidth: 860, margin: "0 auto" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>
              Conventions in{" "}
              <span style={{ color: "var(--accent)" }}>{repoName}</span>
            </h1>
            {scanSubtitle && (
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
                {scanSubtitle}
                {lastScanAt && ` · last scan just now`}
              </p>
            )}
          </div>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            onClick={handleRescan}
            disabled={extract.isPending}
          >
            {extract.isPending ? "Scanning…" : "Re-scan"}
          </Button>
        </div>

        {/* selection bar + create skill button */}
        {visible.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              margin: "16px 0",
            }}
          >
            <button
              onClick={handleDeselectAll}
              disabled={accepted.length === 0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "4px 12px",
                cursor: accepted.length === 0 ? "default" : "pointer",
                color: accepted.length === 0 ? "var(--text-muted)" : "var(--text-secondary)",
                fontSize: 13,
              }}
            >
              <Icon.X size={12} />
              Deselect all
            </button>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {accepted.length} of {total} accepted
            </span>
            <div style={{ marginLeft: "auto" }}>
              <Button
                kind="primary"
                size="sm"
                icon="Sparkles"
                disabled={accepted.length === 0}
                onClick={() => setShowModal(true)}
              >
                Create skill
              </Button>
            </div>
          </div>
        )}

        {/* extraction error banner */}
        {extractError && (
          <div
            style={{
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.4)",
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 13,
              color: "var(--text-secondary)",
              marginBottom: 16,
              display: "flex",
              gap: 8,
            }}
          >
            <Icon.AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1, color: "#f59e0b" }} />
            <span>
              <strong>Extraction failed:</strong> {extractError}
            </span>
          </div>
        )}

        {/* states */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={140} />
            <Skeleton height={140} />
            <Skeleton height={140} />
          </div>
        )}
        {isError && (
          <ErrorState body="Could not load conventions." onRetry={() => refetch()} />
        )}
        {!isLoading && !isError && visible.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title="No conventions found yet"
            body="Click Re-scan to analyse this repository and detect coding conventions."
            cta="Re-scan"
            onCta={handleRescan}
          />
        )}

        {/* convention cards */}
        {visible.map((c) => (
          <ConventionCard
            key={c.id}
            convention={c}
            onUpdate={(id, patch) => update.mutate({ id, patch })}
            isUpdating={update.isPending}
          />
        ))}
      </div>
    </AppShell>
  );
}
