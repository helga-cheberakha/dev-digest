import type { FindingRecord, Agent, ConventionCandidate } from '@devdigest/shared';

type TextContent = { type: 'text'; text: string };
export type ToolResult = { content: TextContent[] };
export type ToolErrorResult = ToolResult & { isError: true };

/** Wrap a successful tool response. */
export function toolOk(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/** Wrap a business-logic failure (not a protocol error). */
export function toolError(message: string): ToolErrorResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Compact finding for concise mode — file:line + key signals, no UUIDs. */
export function compactFinding(f: FindingRecord) {
  return {
    severity: f.severity,
    title: f.title,
    file: f.file,
    line: f.start_line,
    rationale: f.rationale,
  };
}

/** Detailed finding — full fields for response_format:'detailed'. */
export function detailedFinding(f: FindingRecord) {
  return {
    severity: f.severity,
    category: f.category,
    title: f.title,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    rationale: f.rationale,
    suggestion: f.suggestion ?? null,
    confidence: f.confidence,
  };
}

/** Compact agent — id, name, enabled, model only (drops system_prompt etc). */
export function compactAgent(a: Agent) {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    model: a.model,
  };
}

/** Compact convention — drops evidence_snippet (keeps response small). */
export function compactConvention(c: ConventionCandidate) {
  return {
    rule: c.rule,
    file: c.evidence_path,
    confidence: c.confidence,
    accepted: c.accepted,
  };
}
