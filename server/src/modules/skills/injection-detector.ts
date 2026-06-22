/**
 * Regex-based prompt injection detector for skill bodies.
 * Skills are injected as trusted content into AI prompts without untrusted
 * delimiters, so a malicious body is a direct injection vector.
 */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /disregard\s+(your|all|the)\s/i,
  /new\s+instructions?\s*:/i,
  /\[SYSTEM\]|\bSYSTEM\s+PROMPT\b/i,
  /###\s*system\b/i,
  /act\s+as\s+(a|an|the)\s+(?!code\s+reviewer|reviewer)/i,
  /forget\s+(your|all|everything)/i,
  /<\/untrusted>/i,
  /\boverride\b.{0,40}\binstructions?\b/i,
  /you\s+are\s+now\s+(?!a\s+code\s+reviewer)/i,
  /\bDAN\b|\bjailbreak\b/i,
];

export function detectInjection(body: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(body));
}
