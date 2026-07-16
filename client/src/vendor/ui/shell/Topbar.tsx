import React from "react";
import { Icon } from "../icons";
import { IconBtn, Avatar, Kbd } from "../primitives";
import { DefaultLink } from "./DefaultLink";
import type { ShellContext, Crumb } from "./types";

export function Topbar({
  ctx,
  crumb = [],
  isMobile,
  onOpenMobileNav,
}: {
  ctx: ShellContext;
  crumb?: Crumb[];
  isMobile?: boolean;
  /** Present only on mobile — opens the off-canvas sidebar (see AppFrame). */
  onOpenMobileNav?: () => void;
}) {
  const Link = ctx.Link ?? DefaultLink;
  return (
    <header
      style={{
        height: 52,
        flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-primary)",
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 8 : 16,
        padding: isMobile ? "0 12px" : "0 24px",
      }}
    >
      {onOpenMobileNav && (
        <IconBtn icon="Menu" label="Open navigation" onClick={onOpenMobileNav} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden" }}>
        {crumb.map((c, i) => {
          const last = i === crumb.length - 1;
          const text = (
            <span
              className={c.mono ? "mono" : undefined}
              style={{
                fontSize: 14,
                fontWeight: last ? 600 : 500,
                color: last ? "var(--text-primary)" : "var(--text-secondary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "inline-block",
                maxWidth: isMobile ? 140 : undefined,
                verticalAlign: "bottom",
              }}
            >
              {c.label}
            </span>
          );
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <Icon.ChevronRight size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              )}
              {c.href ? <Link href={c.href}>{text}</Link> : text}
            </React.Fragment>
          );
        })}
      </div>
      <button
        onClick={ctx.onOpenCommandPalette}
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: isMobile ? "center" : undefined,
          gap: 10,
          width: isMobile ? 32 : 260,
          flexShrink: 0,
          padding: isMobile ? "8px" : "8px 14px",
          borderRadius: 7,
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        <Icon.Search size={14} />
        {!isMobile && <span style={{ flex: 1, textAlign: "left" }}>Search or jump to…</span>}
        {!isMobile && <Kbd>⌘K</Kbd>}
      </button>
      {ctx.onToggleTheme && (
        <IconBtn
          icon={ctx.theme === "light" ? "Moon" : "Sun"}
          label="Toggle theme"
          onClick={ctx.onToggleTheme}
        />
      )}
      {!isMobile && ctx.onRefresh && <IconBtn icon="RefreshCw" label="Refresh" onClick={ctx.onRefresh} />}
      {!isMobile && <IconBtn icon="Bell" label="Notifications" />}
      <Avatar name="you" size={26} />
    </header>
  );
}
