/* BlastRadius — Blast Radius viewer (A3, L04).
   Colocated under the PR-detail route. Tree (default) + graph (drill-in) over a
   BlastRadius from GET /pulls/:id/blast. Public export name: BlastRadiusView. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, MonoLink } from "@devdigest/ui";
import type { BlastRadius, DownstreamImpact } from "@devdigest/shared";
import { BLAST_VIEWS, GRAPH, STAT_ICONS, type BlastView } from "./constants";
import { blastCounts, isEmptyBlast } from "./helpers";
import { s } from "./styles";

function Summary({ blast }: { blast: BlastRadius }) {
  const t = useTranslations("blast");
  const counts = blastCounts(blast);
  const Stat = ({ icon, n, label }: { icon: keyof typeof Icon; n: number; label: string }) => {
    const I = Icon[icon];
    return (
      <span style={s.stat}>
        <I size={13} style={s.statIcon} />
        <b className="tnum" style={s.statValue}>
          {n}
        </b>
        {label}
      </span>
    );
  };
  return (
    <div style={s.summary}>
      {STAT_ICONS.map((stat) => (
        <Stat key={stat.key} icon={stat.icon} n={counts[stat.key as keyof typeof counts]} label={t(`stat.${stat.key}`)} />
      ))}
    </div>
  );
}

function DownstreamNode({
  d,
  open,
  onToggle,
  onWhy,
}: {
  d: DownstreamImpact;
  open: boolean;
  onToggle: () => void;
  onWhy?: (file: string, line: number) => void;
}) {
  const t = useTranslations("blast");
  return (
    <div style={s.node}>
      <div onClick={onToggle} style={s.nodeHeader(open)}>
        <Icon.ChevronRight size={13} style={s.chevron(open)} />
        <Icon.Code size={13} style={s.nodeIcon} />
        <span className="mono" style={s.nodeSymbol}>
          {d.symbol}()
        </span>
        <span style={s.nodeCallerCount}>{t("callerCount", { count: d.callers.length })}</span>
      </div>
      {open && (
        <div style={s.callerList}>
          {d.callers.map((c, ci) => (
            <div key={ci} style={s.callerRow}>
              <Icon.CornerDownRight size={13} style={s.callerIcon} />
              <span style={s.callerName}>{c.name}</span>
              <MonoLink onClick={onWhy ? () => onWhy(c.file, c.line) : undefined}>
                {c.file}:{c.line}
              </MonoLink>
            </div>
          ))}
          {d.endpoints_affected.length > 0 && (
            <div style={s.badgeRow}>
              {d.endpoints_affected.map((e, ei) => (
                <Badge key={ei} mono icon="Globe" color="var(--accent-text)" bg="var(--accent-bg)">
                  {e}
                </Badge>
              ))}
            </div>
          )}
          {d.crons_affected.length > 0 && (
            <div style={s.cronBadgeRow}>
              {d.crons_affected.map((e, ei) => (
                <Badge key={ei} mono icon="Clock" color="var(--warn)" bg="var(--warn-bg)">
                  {e}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Node-link SVG over ALL downstream symbols with per-symbol attribution:
    each symbol links only to its own callers and endpoints. Symbols with
    nothing downstream are omitted so the graph stays readable. */
function BlastGraph({ blast }: { blast: BlastRadius }) {
  const t = useTranslations("blast");

  const symNodes: { id: string; label: string }[] = [];
  const callerNodes: { id: string; label: string }[] = [];
  const epNodes: { id: string; label: string }[] = [];
  const edges: { from: string; to: string; color: string }[] = [];
  const seen = new Set<string>();

  for (const d of blast.downstream) {
    if (d.callers.length === 0 && d.endpoints_affected.length === 0) continue;
    const symId = `sym:${d.symbol}`;
    if (!seen.has(symId)) {
      seen.add(symId);
      symNodes.push({ id: symId, label: `${d.symbol}()` });
    }
    for (const c of d.callers) {
      const callerId = `caller:${c.file}:${c.line}`;
      if (!seen.has(callerId)) {
        seen.add(callerId);
        callerNodes.push({ id: callerId, label: c.name });
      }
      edges.push({ from: symId, to: callerId, color: "var(--accent)" });
    }
    for (const e of d.endpoints_affected) {
      const epId = `ep:${e}`;
      if (!seen.has(epId)) {
        seen.add(epId);
        epNodes.push({ id: epId, label: e });
      }
      edges.push({ from: symId, to: epId, color: "var(--border-strong)" });
    }
  }

  if (edges.length === 0) {
    return <div style={s.graphEmpty}>{t("graph.empty")}</div>;
  }

  const rows = Math.max(symNodes.length, callerNodes.length, epNodes.length);
  const H = Math.max(GRAPH.minHeight, 60 + rows * GRAPH.rowGap);
  const ySpread = (i: number, count: number) => (count <= 1 ? H / 2 : 35 + (i * (H - 70)) / (count - 1));

  type NodePos = { x: number; y: number; w: number; color: string; label: string };
  const pos = new Map<string, NodePos>();
  symNodes.forEach((n, i) =>
    pos.set(n.id, { x: GRAPH.rootX, y: ySpread(i, symNodes.length), w: GRAPH.nodeWidth, color: "var(--accent)", label: n.label }),
  );
  callerNodes.forEach((n, i) =>
    pos.set(n.id, { x: GRAPH.callerX, y: ySpread(i, callerNodes.length), w: GRAPH.nodeWidth, color: "var(--border-strong)", label: n.label }),
  );
  epNodes.forEach((n, i) =>
    pos.set(n.id, { x: GRAPH.endpointX, y: ySpread(i, epNodes.length), w: GRAPH.endpointNodeWidth, color: "var(--warn)", label: n.label }),
  );

  const trunc = (label: string) => (label.length > GRAPH.maxLabelChars ? label.slice(0, GRAPH.maxLabelChars) + "…" : label);

  const renderEdge = ({ from, to, color }: (typeof edges)[number], key: string) => {
    const a = pos.get(from);
    const b = pos.get(to);
    if (!a || !b) return null;
    const x1 = a.x + a.w / 2;
    const x2 = b.x - b.w / 2;
    const mx = (x1 + x2) / 2;
    return (
      <path
        key={key}
        d={`M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        opacity={0.7}
      />
    );
  };
  const renderNode = (id: string) => {
    const n = pos.get(id);
    if (!n) return null;
    return (
      <g key={id} transform={`translate(${n.x - n.w / 2},${n.y - 13})`}>
        <rect width={n.w} height={26} rx={6} fill="var(--bg-elevated)" stroke={n.color} strokeWidth={1.25} />
        <text x={n.w / 2} y={17} textAnchor="middle" fontSize={11} fill="var(--text-primary)" className="mono">
          {trunc(n.label)}
        </text>
      </g>
    );
  };

  return (
    <svg width={GRAPH.width} height={H} style={s.graphSvg} role="img" aria-label={t("graph.ariaLabel")}>
      {edges.map((e, i) => renderEdge(e, `e-${i}`))}
      {[...pos.keys()].map(renderNode)}
    </svg>
  );
}

export interface BlastRadiusViewProps {
  blast: BlastRadius;
  /** Optional git-why hook: clicking a caller location fires this. */
  onWhy?: (file: string, line: number) => void;
}

export function BlastRadiusView({ blast, onWhy }: BlastRadiusViewProps) {
  const t = useTranslations("blast");
  const [view, setView] = React.useState<BlastView>("tree");
  // Keyed by index, not symbol — downstream can contain the same symbol twice
  // (e.g. "CompletionResult"), which would collide as a React key and share toggle state.
  const [open, setOpen] = React.useState<Record<number, boolean>>((): Record<number, boolean> =>
    blast.downstream[0] ? { 0: true } : {},
  );

  if (isEmptyBlast(blast)) {
    return <div style={s.emptySummary}>{blast.summary}</div>;
  }

  return (
    <div style={s.root}>
      <div style={s.headerRow}>
        <Summary blast={blast} />
        <div style={s.viewToggle}>
          {BLAST_VIEWS.map((v) => (
            <button key={v} onClick={() => setView(v)} style={s.toggleBtn(view === v)}>
              {t(`view.${v}`)}
            </button>
          ))}
        </div>
      </div>
      <div style={s.summaryText}>{blast.summary}</div>
      {view === "tree" ? (
        <div style={s.tree}>
          {blast.downstream.length === 0 ? (
            <div style={s.treeEmpty}>{t("noDownstream", { count: blast.changed_symbols.length })}</div>
          ) : (
            blast.downstream.map((d, i) => (
              <DownstreamNode
                key={`${d.symbol}-${i}`}
                d={d}
                open={!!open[i]}
                onToggle={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
                onWhy={onWhy}
              />
            ))
          )}
        </div>
      ) : (
        <BlastGraph blast={blast} />
      )}
    </div>
  );
}

export default BlastRadiusView;
