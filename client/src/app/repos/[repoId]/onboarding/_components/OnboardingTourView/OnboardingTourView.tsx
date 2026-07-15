/* OnboardingTourView.tsx — per-repo Onboarding Tour page.
   Covers AC-20 (five collapsible cards, sticky scroll-spy nav, header, Regenerate/Share),
   AC-21 (external blob links target=_blank), AC-22 (clipboard copy),
   AC-23 (First-task cards: no href/navigation handler).
   First-visit state: render generate affordance, NEVER auto-POST on mount. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "../../../../../../components/app-shell";
import { Button, Badge, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { SafeMarkdown } from "../../../../../../components/SafeMarkdown";
import {
  useOnboarding,
  useGenerateOnboarding,
} from "../../../../../../lib/hooks/onboarding";
import { formatTimeAgo } from "../../../../../../lib/time-ago";
import type {
  OnboardingArtifact,
  OnboardingDiagram,
  CriticalPathEntry,
  HowToRunStep,
  ReadingPathEntry,
  FirstTaskEntry,
} from "@devdigest/shared";

// ---- Section scroll-target IDs ----

const SECTION_ARCHITECTURE = "section-architecture";
const SECTION_CRITICAL_PATHS = "section-critical-paths";
const SECTION_HOW_TO_RUN = "section-how-to-run";
const SECTION_READING_PATH = "section-reading-path";
const SECTION_FIRST_TASKS = "section-first-tasks";

const ALL_SECTIONS = [
  SECTION_ARCHITECTURE,
  SECTION_CRITICAL_PATHS,
  SECTION_HOW_TO_RUN,
  SECTION_READING_PATH,
  SECTION_FIRST_TASKS,
] as const;

type SectionId = (typeof ALL_SECTIONS)[number];

// ---- Pure helpers ----

function writeToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

// ---- Collapsible card wrapper (keyboard-operable via <button>) ----

function CollapsibleCard({
  id,
  title,
  icon,
  isOpen,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-elevated)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`${id}-body`}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "16px 20px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text-primary)",
        }}
      >
        <span style={{ color: "var(--accent)", display: "flex", alignItems: "center" }}>
          {icon}
        </span>
        <span style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>{title}</span>
        <Icon.ChevronDown
          size={18}
          style={{
            color: "var(--text-muted)",
            transform: isOpen ? "rotate(180deg)" : undefined,
            transition: "transform 0.2s",
            flexShrink: 0,
          }}
        />
      </button>
      {isOpen && (
        <div id={`${id}-body`} style={{ padding: "0 20px 20px" }}>
          {children}
        </div>
      )}
    </section>
  );
}

// ---- Architecture diagram (SVG, BFS column layout) ----

function ArchitectureDiagram({
  diagram,
  diagramAriaLabel,
  noDiagramLabel,
}: {
  diagram: OnboardingDiagram;
  diagramAriaLabel: string;
  noDiagramLabel: string;
}) {
  const { nodes, edges } = diagram;

  if (nodes.length === 0) {
    return (
      <div
        role="img"
        aria-label={noDiagramLabel}
        style={{
          padding: "24px",
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: 13,
          borderRadius: 6,
          background: "var(--bg-hover)",
        }}
      >
        {noDiagramLabel}
      </div>
    );
  }

  // BFS-based column assignment
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const outEdges = new Map<string, string[]>(nodes.map((n) => [n.id, []]));

  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    outEdges.get(e.from)?.push(e.to);
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];

  for (const [nodeId, deg] of inDegree) {
    if (deg === 0) {
      levels.set(nodeId, 0);
      queue.push(nodeId);
    }
  }
  // All nodes have incoming edges (cycle) — seed at level 0
  if (queue.length === 0) {
    for (const n of nodes) {
      levels.set(n.id, 0);
      queue.push(n.id);
    }
  }

  // BFS level propagation — noUncheckedIndexedAccess-safe via shift()
  // Bounded by nodes.length * nodes.length to prevent infinite loops on cyclic input.
  const MAX_BFS = nodes.length * nodes.length + nodes.length;
  let bfsCount = 0;
  while (queue.length > 0 && bfsCount < MAX_BFS) {
    bfsCount++;
    const nodeId = queue.shift()!; // safe: queue.length > 0
    const level = levels.get(nodeId) ?? 0;
    for (const next of (outEdges.get(nodeId) ?? [])) {
      const newLevel = level + 1;
      if ((levels.get(next) ?? -1) < newLevel) {
        levels.set(next, newLevel);
        queue.push(next);
      }
    }
  }
  // Ensure all nodes have a level
  for (const n of nodes) {
    if (!levels.has(n.id)) levels.set(n.id, 0);
  }

  // Group by column
  const colMap = new Map<number, string[]>();
  for (const [nodeId, level] of levels) {
    if (!colMap.has(level)) colMap.set(level, []);
    colMap.get(level)!.push(nodeId);
  }
  const sortedCols = Array.from(colMap.entries()).sort(([a], [b]) => a - b);

  const NODE_W = 120;
  const NODE_H = 36;
  const COL_GAP = 72;
  const ROW_GAP = 14;
  const PAD = 16;
  const maxRows = sortedCols.reduce((acc, [, ids]) => Math.max(acc, ids.length), 1);
  const positions = new Map<string, { x: number; y: number }>();

  sortedCols.forEach(([, ids], colIndex) => {
    const x = PAD + colIndex * (NODE_W + COL_GAP);
    const totalH = ids.length * (NODE_H + ROW_GAP) - ROW_GAP;
    const topOffset = (maxRows * (NODE_H + ROW_GAP) - ROW_GAP - totalH) / 2 + PAD;
    ids.forEach((id, rowIndex) => {
      positions.set(id, { x, y: topOffset + rowIndex * (NODE_H + ROW_GAP) });
    });
  });

  const svgW = PAD + sortedCols.length * (NODE_W + COL_GAP) - COL_GAP + PAD;
  const svgH = PAD + maxRows * (NODE_H + ROW_GAP) - ROW_GAP + PAD;

  return (
    <div
      role="img"
      aria-label={diagramAriaLabel}
      style={{ background: "var(--bg)", borderRadius: 8, overflow: "auto", padding: 8 }}
    >
      <svg
        width={Math.max(svgW, 220)}
        height={Math.max(svgH, 70)}
        style={{ display: "block" }}
      >
        <defs>
          <marker
            id="obd-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="5.5"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--border-strong)" />
          </marker>
        </defs>

        {edges.map((e, i) => {
          const from = positions.get(e.from);
          const to = positions.get(e.to);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={1.5}
              markerEnd="url(#obd-arrow)"
            />
          );
        })}

        {nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const short = node.label.length > 15 ? node.label.slice(0, 13) + "…" : node.label;
          const isOverflow = node.kind === "overflow";
          return (
            <g key={node.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                rx={5}
                fill={isOverflow ? "var(--bg-hover)" : "var(--bg-elevated)"}
                stroke={isOverflow ? "var(--border-strong)" : "var(--border)"}
                strokeWidth={1}
                strokeDasharray={isOverflow ? "4 2" : undefined}
              />
              <text
                x={pos.x + NODE_W / 2}
                y={pos.y + NODE_H / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={isOverflow ? "var(--text-muted)" : "var(--text-secondary)"}
                fontSize={11}
                fontFamily="monospace"
              >
                {short}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---- Critical path row (AC-21: external blob link, target=_blank) ----

function CriticalPathRow({
  entry,
  openLabel,
  openAriaLabel,
}: {
  entry: CriticalPathEntry;
  openLabel: string;
  openAriaLabel: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: "var(--bg-hover)",
        borderRadius: 6,
      }}
    >
      <Icon.File size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span
        style={{
          fontFamily: "monospace",
          fontSize: 13,
          color: "var(--accent-text)",
          flex: 1,
          minWidth: 0,
          wordBreak: "break-all",
        }}
      >
        {entry.file}
      </span>
      <span
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          flex: 2,
          minWidth: 0,
        }}
      >
        &mdash; {entry.rationale}
      </span>
      {/* AC-21: external blob link, target=_blank — not a Next.js Link */}
      <a
        href={entry.link}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={openAriaLabel}
        style={{
          fontSize: 12,
          fontWeight: 500,
          padding: "4px 10px",
          borderRadius: 5,
          border: "1px solid var(--border-strong)",
          color: "var(--text-primary)",
          textDecoration: "none",
          background: "var(--bg-elevated)",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {openLabel}
      </a>
    </div>
  );
}

// ---- How-to-run row (AC-22: copy command to clipboard) ----

function HowToRunRow({
  step,
  index,
  copyAriaLabel,
  copiedLabel,
  isCopied,
  onCopy,
}: {
  step: HowToRunStep;
  index: number;
  copyAriaLabel: string;
  copiedLabel: string;
  isCopied: boolean;
  onCopy: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 14px",
        background: "var(--bg)",
        borderRadius: 6,
        border: "1px solid var(--border)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          fontWeight: 600,
          width: 18,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {index}
      </span>
      <code
        style={{
          fontFamily: "monospace",
          fontSize: 13,
          color: "var(--text-primary)",
          flex: 1,
          minWidth: 0,
          wordBreak: "break-all",
        }}
      >
        {step.command}
      </code>
      {/* AC-22: copy command to clipboard */}
      <button
        type="button"
        onClick={onCopy}
        aria-label={isCopied ? copiedLabel : copyAriaLabel}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: isCopied ? "var(--ok)" : "var(--text-muted)",
          padding: 4,
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        {isCopied ? <Icon.Check size={14} /> : <Icon.Copy size={14} />}
      </button>
    </div>
  );
}

// ---- Reading path row (AC-21: external blob link, target=_blank) ----

function ReadingPathRow({
  entry,
  index,
  openAriaLabel,
}: {
  entry: ReadingPathEntry;
  index: number;
  openAriaLabel: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
      <div
        aria-hidden="true"
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "var(--accent)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {index}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* AC-21: external blob link, target=_blank */}
        <a
          href={entry.link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={openAriaLabel}
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            color: "var(--accent-text)",
            fontWeight: 600,
            textDecoration: "none",
            display: "block",
          }}
        >
          {entry.file}
        </a>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "2px 0 0" }}>
          {entry.rationale}
        </p>
      </div>
    </div>
  );
}

// ---- First-task card (AC-23: no href or navigation handler) ----

function FirstTaskCard({
  task,
  complexityLabel,
  gapLabel,
  pathLabel,
  patternLabel,
}: {
  task: FirstTaskEntry;
  complexityLabel: string;
  gapLabel: string;
  pathLabel: string;
  patternLabel: string;
}) {
  // AC-23: this card is informational only — no href or navigation handler.
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "var(--bg-hover)",
        borderRadius: 8,
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
        {task.title}
      </div>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 10px" }}>
        {task.rationale}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Badge style={{ fontWeight: 400 }}>{gapLabel}</Badge>
        <Badge style={{ fontWeight: 400 }}>{pathLabel}</Badge>
        <Badge style={{ fontWeight: 400 }}>{complexityLabel}</Badge>
      </div>
      {task.patternPointer && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0 0" }}>
          {patternLabel}
        </p>
      )}
    </div>
  );
}

// ---- Main export ----

export function OnboardingTourView({ repoId }: { repoId: string }) {
  const t = useTranslations("onboardingTour");
  const { data, isLoading, isError, refetch } = useOnboarding(repoId);
  const generate = useGenerateOnboarding(repoId);

  // All cards open by default
  const [openCards, setOpenCards] = React.useState<Set<SectionId>>(
    () => new Set<SectionId>(ALL_SECTIONS)
  );

  const [activeSection, setActiveSection] = React.useState<string>(SECTION_ARCHITECTURE);

  // Per-item copy feedback: maps a key string to "just copied"
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  const toggleCard = (id: SectionId) => {
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopy = (text: string, key: string) => {
    writeToClipboard(text)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
      })
      .catch(() => {
        // clipboard may be unavailable in some browser contexts
      });
  };

  // AC-22: Share copies the internal onboarding URL
  const handleShare = () => {
    if (typeof window !== "undefined") {
      handleCopy(window.location.href, "__share__");
    }
  };

  const handleRegenerate = () => {
    generate.mutate({ force: true });
  };

  // Scroll-spy via IntersectionObserver
  React.useEffect(() => {
    if (!data) return;

    const elements = ALL_SECTIONS
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.filter((e) => e.isIntersecting);
        // Use the first intersecting entry (topmost visible section)
        for (const entry of intersecting) {
          setActiveSection(entry.target.id);
          break;
        }
      },
      { rootMargin: "-10% 0px -65% 0px", threshold: 0 }
    );

    elements.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [data]);

  // ---- Loading ----
  if (isLoading) {
    return (
      <AppShell crumb={[{ label: t("page.crumb") }]}>
        <div
          style={{
            padding: "24px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            maxWidth: 900,
            margin: "0 auto",
          }}
        >
          <Skeleton height={32} width={340} />
          <Skeleton height={18} width={420} />
          <Skeleton height={220} />
          <Skeleton height={180} />
        </div>
      </AppShell>
    );
  }

  // ---- Error ----
  if (isError) {
    return (
      <AppShell crumb={[{ label: t("page.crumb") }]}>
        <ErrorState title={t("page.error")} onRetry={refetch} />
      </AppShell>
    );
  }

  // ---- First-visit: data is null (no tour yet) or undefined (edge case).
  // AC-20: render generate affordance. NEVER auto-POST on mount (== no useEffect POST). ----
  if (data == null) {
    return (
      <AppShell crumb={[{ label: t("page.crumb") }]}>
        <EmptyState
          icon="Zap"
          title={t("page.generate.title")}
          body={t("page.generate.body")}
          cta={t("page.generate.cta")}
          onCta={() => generate.mutate({})}
          ctaLoading={generate.isPending}
        />
      </AppShell>
    );
  }

  // ---- Tour view ----
  // data is now narrowed to OnboardingArtifact
  const artifact: OnboardingArtifact = data;
  const { sections } = artifact;

  // Nav labels as explicit literals (avoids computed-key TypeScript issues)
  const navItems: Array<{ id: SectionId; label: string }> = [
    { id: SECTION_ARCHITECTURE, label: t("nav.architecture") },
    { id: SECTION_CRITICAL_PATHS, label: t("nav.criticalPaths") },
    { id: SECTION_HOW_TO_RUN, label: t("nav.howToRun") },
    { id: SECTION_READING_PATH, label: t("nav.readingPath") },
    { id: SECTION_FIRST_TASKS, label: t("nav.firstTasks") },
  ];

  return (
    <AppShell
      crumb={[
        { label: artifact.repoName },
        { label: t("page.crumb") },
      ]}
    >
      <div
        style={{
          display: "flex",
          gap: 32,
          padding: "24px 32px",
          maxWidth: 1100,
          margin: "0 auto",
          alignItems: "flex-start",
        }}
      >
        {/* Left: sticky "ON THIS PAGE" scroll-spy nav (WCAG: keyboard-accessible links) */}
        <nav
          aria-label={t("nav.title")}
          style={{
            width: 196,
            flexShrink: 0,
            position: "sticky",
            top: 24,
            alignSelf: "flex-start",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: 10,
            }}
          >
            {t("nav.title")}
          </div>
          {navItems.map(({ id, label }) => {
            const isActive = activeSection === id;
            return (
              <a
                key={id}
                href={`#${id}`}
                style={{
                  display: "block",
                  padding: "5px 10px",
                  borderLeft: `2px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  textDecoration: "none",
                  fontSize: 13,
                  lineHeight: 1.4,
                  marginBottom: 3,
                  fontWeight: isActive ? 500 : 400,
                  transition: "color 0.15s, border-color 0.15s",
                }}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
                  setActiveSection(id);
                }}
              >
                {label}
              </a>
            );
          })}
        </nav>

        {/* Right: scrollable main content */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Page header */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  margin: 0,
                  lineHeight: 1.25,
                }}
              >
                {t("page.title")}{" "}
                <span style={{ color: "var(--accent)" }}>{artifact.repoName}</span>
              </h1>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  margin: "6px 0 0",
                }}
              >
                {t("page.meta", {
                  filesIndexed: artifact.filesIndexed.toLocaleString(),
                  timeAgo: formatTimeAgo(artifact.generatedAt),
                })}
              </p>
            </div>

            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <Button
                kind="secondary"
                icon="RefreshCw"
                onClick={handleRegenerate}
                loading={generate.isPending}
              >
                {t("page.regenerate")}
              </Button>
              {/* AC-22: Share copies the internal onboarding URL */}
              <Button kind="secondary" icon="Copy" onClick={handleShare}>
                {copiedKey === "__share__" ? t("page.shared") : t("page.share")}
              </Button>
            </div>
          </div>

          {/* Degraded banner — WCAG: text label + icon, NOT color-only (AC-20) */}
          {artifact.degraded === true && (
            <div
              role="status"
              aria-label={t("page.degraded")}
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                {t("page.degraded")}
              </Badge>
              {artifact.degradedReason && (
                <Badge color="var(--warn)" bg="var(--warn-bg)">
                  {t("page.degradedReason", { reason: artifact.degradedReason })}
                </Badge>
              )}
            </div>
          )}

          {/* Narrative-unavailable banner — text + icon (not color-only) */}
          {artifact.narrativeUnavailable === true && (
            <div role="status" aria-label={t("page.narrativeUnavailable")}>
              <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                {t("page.narrativeUnavailable")}
              </Badge>
            </div>
          )}

          {/* 1. Architecture overview card */}
          <CollapsibleCard
            id={SECTION_ARCHITECTURE}
            title={t("architecture.title")}
            icon={<Icon.Layers size={18} />}
            isOpen={openCards.has(SECTION_ARCHITECTURE)}
            onToggle={() => toggleCard(SECTION_ARCHITECTURE)}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <SafeMarkdown content={sections.architecture.overview} />
              <ArchitectureDiagram
                diagram={sections.architecture.diagram}
                diagramAriaLabel={t("architecture.diagramAriaLabel")}
                noDiagramLabel={t("architecture.noDiagram")}
              />
            </div>
          </CollapsibleCard>

          {/* 2. Critical paths card (AC-21: Open = external blob link) */}
          <CollapsibleCard
            id={SECTION_CRITICAL_PATHS}
            title={t("criticalPaths.title")}
            icon={<Icon.Zap size={18} />}
            isOpen={openCards.has(SECTION_CRITICAL_PATHS)}
            onToggle={() => toggleCard(SECTION_CRITICAL_PATHS)}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sections.criticalPaths.map((entry: CriticalPathEntry, idx: number) => (
                <CriticalPathRow
                  key={idx}
                  entry={entry}
                  openLabel={t("criticalPaths.open")}
                  openAriaLabel={t("criticalPaths.openAriaLabel", { file: entry.file })}
                />
              ))}
            </div>
          </CollapsibleCard>

          {/* 3. How to run locally card (AC-22: copy to clipboard) */}
          <CollapsibleCard
            id={SECTION_HOW_TO_RUN}
            title={t("howToRun.title")}
            icon={<Icon.Command size={18} />}
            isOpen={openCards.has(SECTION_HOW_TO_RUN)}
            onToggle={() => toggleCard(SECTION_HOW_TO_RUN)}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sections.howToRun.map((step: HowToRunStep, idx: number) => (
                <HowToRunRow
                  key={idx}
                  step={step}
                  index={idx + 1}
                  copyAriaLabel={t("howToRun.copyAriaLabel")}
                  copiedLabel={t("howToRun.copied")}
                  isCopied={copiedKey === `run-${idx}`}
                  onCopy={() => handleCopy(step.command, `run-${idx}`)}
                />
              ))}
            </div>
          </CollapsibleCard>

          {/* 4. Guided reading path card (AC-21: file links external blob) */}
          <CollapsibleCard
            id={SECTION_READING_PATH}
            title={t("readingPath.title")}
            icon={<Icon.ListChecks size={18} />}
            isOpen={openCards.has(SECTION_READING_PATH)}
            onToggle={() => toggleCard(SECTION_READING_PATH)}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {sections.readingPath.map((entry: ReadingPathEntry, idx: number) => (
                <ReadingPathRow
                  key={idx}
                  entry={entry}
                  index={idx + 1}
                  openAriaLabel={t("readingPath.openAriaLabel", { file: entry.file })}
                />
              ))}
            </div>
          </CollapsibleCard>

          {/* 5. First tasks card (AC-23: no href or navigation handler) */}
          <CollapsibleCard
            id={SECTION_FIRST_TASKS}
            title={t("firstTasks.title")}
            icon={<Icon.Target size={18} />}
            isOpen={openCards.has(SECTION_FIRST_TASKS)}
            onToggle={() => toggleCard(SECTION_FIRST_TASKS)}
          >
            {!sections.firstTasks || sections.firstTasks.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
                {t("firstTasks.empty")}
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sections.firstTasks.map((task: FirstTaskEntry, idx: number) => (
                  /* AC-23: FirstTaskCard has no href or navigation handler */
                  <FirstTaskCard
                    key={idx}
                    task={task}
                    gapLabel={t("firstTasks.gap", { value: task.gapType })}
                    pathLabel={t("firstTasks.suggestedPath", { value: task.suggestedPath })}
                    complexityLabel={t("firstTasks.complexity", { value: task.complexity })}
                    patternLabel={t("firstTasks.pattern", { value: task.patternPointer })}
                  />
                ))}
              </div>
            )}
          </CollapsibleCard>
        </div>
      </div>
    </AppShell>
  );
}
