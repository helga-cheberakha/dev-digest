/* agent-visual.ts — best-effort icon + deterministic color for an agent,
   used anywhere multiple agents are shown side by side (multi-agent picker,
   Configure-run page, results Columns/Tabs, conflict rows) so agents are
   visually distinguishable at a glance instead of all sharing one generic
   icon. Purely presentational: agents have no persisted icon/color field. */
import type { IconName } from "@devdigest/ui";

/** Keyword → icon, matched against the agent's name. First match wins. */
const ICON_RULES: ReadonlyArray<readonly [RegExp, IconName]> = [
  [/security/i, "Shield"],
  [/perf(ormance)?/i, "Zap"],
  [/test|quality|\bqa\b/i, "FlaskConical"],
  [/mentor|junior|learn/i, "Lightbulb"],
  [/customer|support|user.?facing/i, "MessageSquare"],
  [/architect/i, "Boxes"],
  [/doc(s|umentation)?/i, "FileText"],
  [/bug|defect/i, "Bug"],
];

/** Best-effort icon for a known agent persona name; falls back to the
    sitewide generic agent icon (matches AgentCard's default). */
export function agentIcon(name: string): IconName {
  for (const [re, icon] of ICON_RULES) {
    if (re.test(name)) return icon;
  }
  return "Cpu";
}

/** Fixed rotation over the app's existing semantic color tokens (not new
    hex values) so per-agent color stays theme-aware in light/dark. */
const COLOR_TOKENS: ReadonlyArray<{ ring: string; bg: string }> = [
  { ring: "var(--accent)", bg: "var(--accent-bg)" },
  { ring: "var(--ok)", bg: "var(--ok-bg)" },
  { ring: "var(--warn)", bg: "var(--warn-bg)" },
  { ring: "var(--crit)", bg: "var(--crit-bg)" },
  { ring: "var(--info)", bg: "var(--info-bg)" },
];

/** Deterministic color pair for an agent id — stable across renders and
    sessions (simple string hash), so the same agent always looks the same. */
export function agentColor(agentId: string): { ring: string; bg: string } {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  }
  const idx = (hash >>> 0) % COLOR_TOKENS.length;
  return COLOR_TOKENS[idx]!;
}
