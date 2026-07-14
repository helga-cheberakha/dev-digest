/* LineChart — multi-series line chart on Recharts. */
import React from "react";
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface ChartSeries {
  name: string;
  color: string;
  data: number[];
}

/** Per-point tooltip content, index-aligned with each series' `data`. Caller
    pre-formats — this component stays generic/app-agnostic. */
export interface ChartPoint {
  /** Primary line, e.g. a formatted timestamp. */
  label: string;
  /** Optional secondary line, e.g. "v3 · $0.06". */
  detail?: string;
}

export function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
}) {
  const row = payload?.[0]?.payload;
  const label = row?.__label;
  if (!active || typeof label !== "string") return null;
  const detail = row?.__detail;
  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 12,
        lineHeight: 1.4,
        color: "var(--text-primary)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      }}
    >
      <div>{label}</div>
      {typeof detail === "string" && detail !== "" && (
        <div style={{ color: "var(--text-secondary)" }}>{detail}</div>
      )}
    </div>
  );
}

export function LineChart({
  series,
  points,
  w = 620,
  h = 200,
  yMin = 0.6,
  yMax = 1.0,
}: {
  series: ChartSeries[];
  /** Optional per-point tooltip content, index-aligned with `series[i].data`. */
  points?: ChartPoint[];
  w?: number;
  h?: number;
  yMin?: number;
  yMax?: number;
}) {
  const n = series[0]?.data.length ?? 0;
  const rows = Array.from({ length: n }, (_, i) => {
    const row: Record<string, number | string> = { i };
    series.forEach((s) => {
      row[s.name] = s.data[i] ?? 0;
    });
    if (points?.[i]) {
      row.__label = points[i]!.label;
      if (points[i]!.detail !== undefined) row.__detail = points[i]!.detail!;
    }
    return row;
  });
  return (
    <div style={{ width: "100%", maxWidth: w, height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <RLineChart data={rows} margin={{ top: 14, right: 14, bottom: 8, left: -10 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="i" hide />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 12, fill: "var(--text-muted)" }}
            tickFormatter={(v: number) => v.toFixed(1)}
            axisLine={false}
            tickLine={false}
            width={38}
          />
          {points && (
            <Tooltip
              cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
              content={<ChartTooltip />}
              isAnimationActive={false}
            />
          )}
          {series.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
}
