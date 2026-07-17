"use client";

/**
 * PeriodPicker — dropdown period selector for the Agent Performance dashboard.
 *
 * Three presets: "30 days", "1 day", plus a "Custom range" option that reveals
 * two date inputs (from/to, YYYY-MM-DD) when selected.
 *
 * Keyboard-operable (WCAG AA):
 *   - Trigger button opens the listbox via click, Space, or Enter.
 *   - Arrow keys navigate between options within the open listbox.
 *   - Enter or click selects the focused option.
 *   - Escape closes without changing the selection and returns focus to the trigger.
 *   - All inputs are natively focusable via Tab.
 */

import React, { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import type { PerfWindow } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PeriodMode = "30d" | "1d" | "custom";

const PRESET_MODES: PeriodMode[] = ["30d", "1d", "custom"];

function modeOf(w: PerfWindow): PeriodMode {
  return w.period as PeriodMode;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PeriodPickerProps {
  value: PerfWindow;
  onChange: (w: PerfWindow) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PeriodPicker({ value, onChange }: PeriodPickerProps) {
  const t = useTranslations("agentPerformance");

  const [open, setOpen] = useState(false);
  // Track which mode is shown in the dropdown (may differ from committed value)
  const [pendingMode, setPendingMode] = useState<PeriodMode>(modeOf(value));
  const [customFrom, setCustomFrom] = useState(
    value.period === "custom" ? value.from : "",
  );
  const [customTo, setCustomTo] = useState(
    value.period === "custom" ? value.to : "",
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusFirstOptionRef = useRef(false);
  const focusLastOptionRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Close on outside mousedown
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ---------------------------------------------------------------------------
  // Focus the first option once the dropdown has actually committed to the DOM
  // (a keyboard open sets focusFirstOptionRef before calling openDropdown()).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (open && focusFirstOptionRef.current) {
      focusFirstOptionRef.current = false;
      optionRefs.current[0]?.focus();
    } else if (open && focusLastOptionRef.current) {
      focusLastOptionRef.current = false;
      optionRefs.current[optionRefs.current.length - 1]?.focus();
    }
  }, [open]);

  // ---------------------------------------------------------------------------
  // Labels
  // ---------------------------------------------------------------------------

  function modeLabel(m: PeriodMode): string {
    if (m === "30d") return t("periodPicker.30d");
    if (m === "1d") return t("periodPicker.1d");
    return t("periodPicker.custom");
  }

  function triggerLabel(): string {
    const committed = modeOf(value);
    if (committed === "custom" && value.period === "custom") {
      return `${value.from} – ${value.to}`;
    }
    return modeLabel(committed);
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function openDropdown() {
    setOpen(true);
    setPendingMode(modeOf(value));
  }

  function closeDropdown() {
    setOpen(false);
  }

  function handleTriggerClick() {
    if (open) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      focusFirstOptionRef.current = true;
      openDropdown();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusLastOptionRef.current = true;
      openDropdown();
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      closeDropdown();
    }
  }

  function handleOptionKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(index + 1, PRESET_MODES.length - 1);
      optionRefs.current[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (index === 0) {
        triggerRef.current?.focus();
        closeDropdown();
      } else {
        optionRefs.current[index - 1]?.focus();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeDropdown();
      triggerRef.current?.focus();
    }
  }

  function selectMode(m: PeriodMode) {
    if (m !== "custom") {
      setPendingMode(m);
      closeDropdown();
      onChange({ period: m });
    } else {
      // Custom: stay open, reveal date inputs
      setPendingMode("custom");
    }
  }

  function handleApply() {
    if (customFrom && customTo) {
      closeDropdown();
      onChange({ period: "custom", from: customFrom, to: customTo });
    }
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const triggerStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    cursor: "pointer",
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.4,
  };

  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    minWidth: 180,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    boxShadow: "var(--shadow-modal)",
    padding: 6,
    zIndex: 50,
  };

  function optionStyle(m: PeriodMode): React.CSSProperties {
    const isActive = pendingMode === m;
    return {
      display: "block",
      width: "100%",
      textAlign: "left",
      padding: "8px 10px",
      border: "none",
      borderRadius: 5,
      background: isActive ? "var(--bg-hover)" : "transparent",
      color: "var(--text-primary)",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: isActive ? 600 : 400,
    };
  }

  const dateInputStyle: React.CSSProperties = {
    width: "100%",
    padding: "4px 8px",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    color: "var(--text-primary)",
    fontSize: 12,
    marginBottom: 8,
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    color: "var(--text-muted)",
    marginBottom: 4,
  };

  const applyBtnStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px",
    background: customFrom && customTo ? "var(--accent)" : "var(--bg-hover)",
    border: "none",
    borderRadius: 5,
    color: customFrom && customTo ? "var(--accent-text)" : "var(--text-muted)",
    fontSize: 12,
    fontWeight: 600,
    cursor: customFrom && customTo ? "pointer" : "not-allowed",
    opacity: customFrom && customTo ? 1 : 0.5,
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        style={triggerStyle}
      >
        {triggerLabel()}
        <span aria-hidden="true" style={{ fontSize: 10 }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("periodPicker.ariaLabel")}
          style={dropdownStyle}
        >
          {PRESET_MODES.map((m, i) => (
            <button
              key={m}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={pendingMode === m}
              onClick={() => selectMode(m)}
              onKeyDown={(e) => handleOptionKeyDown(e, i)}
              style={optionStyle(m)}
            >
              {modeLabel(m)}
            </button>
          ))}

          {pendingMode === "custom" && (
            <div
              style={{
                padding: "8px 10px",
                borderTop: "1px solid var(--border)",
                marginTop: 4,
              }}
            >
              <label style={labelStyle}>{t("periodPicker.from")}</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label={t("periodPicker.from")}
                style={dateInputStyle}
              />
              <label style={labelStyle}>{t("periodPicker.to")}</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label={t("periodPicker.to")}
                style={dateInputStyle}
              />
              <button
                type="button"
                onClick={handleApply}
                disabled={!customFrom || !customTo}
                style={applyBtnStyle}
              >
                {t("periodPicker.apply")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
