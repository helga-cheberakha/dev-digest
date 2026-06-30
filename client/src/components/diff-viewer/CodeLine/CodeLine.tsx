"use client";

import React from "react";
import type { Line } from "../helpers";
import type { CommentThread, DiffCommentApi } from "../comments";
import { commentTargetFor, cs } from "../comments";
import { CommentThreadView, InlineComposer } from "../DiffComments";
import { s, lineRowFor, lineSignFor } from "../styles";

export interface CodeLineProps {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Override row background (used by SmartDiffViewer to highlight finding lines). */
  rowBackground?: string;
  /** Element rendered at the end of the line (e.g. a finding badge). */
  rightBadge?: React.ReactNode;
}

export function CodeLine({ ln, path, threads, commenting, rowBackground, rightBadge }: CodeLineProps) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  const rowStyle = { ...lineRowFor(ln.kind), ...(rowBackground ? { background: rowBackground } : {}) };

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={rowStyle}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            />
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {rightBadge}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
