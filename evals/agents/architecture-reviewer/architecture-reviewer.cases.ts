import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// The fixture diffs target files/modules that were never created on disk (synthetic test data).
// Without this note, the agent's Phase 1 discovery sometimes finds the target module missing and
// treats the diff as a "hypothetical proposal" rather than authoritative — a real observed failure
// mode that inflates turn count/variance and derails scoring on unrelated axes.
const FIXTURE_NOTE =
  "Treat this diff as authoritative and already applied to the working tree, even if the target " +
  "file or module is not present on disk — do not spend turns verifying file existence or treat " +
  "the diff as hypothetical.";

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${FIXTURE_NOTE}

${fx("checkout-service.diff")}`;

// Isolates JUST the checkout-service.diff's domain-layer hunk (the FastifyReply import AND its
// use as a same-function parameter) with the unrelated service.ts DI violation removed. Added
// after `results/outputs/*` traces showed the compound checkout-service.diff reproduces one
// specific failure in 8/8 sampled runs (both strict and lite): the agent reports the import and
// the parameter as TWO separate CRITICAL findings instead of one merged finding citing both
// lines — not a security-dimension fabrication (Concern Matrix always shows "Security surface:
// NONE"), just the same Coupling violation double-counted. This fixture removes the
// service.ts DI hunk so the merge behavior can be scored without a second, unrelated violation
// competing for the model's attention.
const FASTIFY_LEAK_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${FIXTURE_NOTE}

${fx("fastify-type-leak.diff")}`;

// A second real diff whose violations map onto DevDigest-SPECIFIC rule names
// (`reviewer-core-zero-io`, `reviewer-core-ground-findings-gate`) that a competent model will
// describe in prose but will not spontaneously name unless the agent forces a citation. This is
// the discriminating case for the strict-vs-lite A/B: both variants should FIND both problems,
// but only the strict variant (which keeps the "cite the exact documented rule per finding" hard
// rule) should reliably emit the identifier. The checkout diff's textbook violations don't
// discriminate — the model volunteers `inward-only-dependencies`/`di-discipline` either way.
const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${FIXTURE_NOTE}

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${FIXTURE_NOTE}

${fx("benign-refactor.diff")}`;

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "cites the specific documented rule" keeps passing.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a violation of the inward-only dependency rule between Domain and Presentation layers",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a violation of DI discipline (concrete adapters/repositories must be constructed only in the composition root / container)",
      "names the specific documented rule identifier for both the fastify-import and repository-instantiation findings (`inward-only-dependencies`, `di-discipline`) rather than describing the problem only in prose — an additional finding outside the rule catalog may legitimately use the `unmapped-observation` fallback instead of a catalog identifier",
      "assigns a severity (critical/high/medium/low/info) to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    // Originally framed as "does not fabricate a security-shaped finding" — renamed after trace
    // review showed that was never the actual failure. The model never fabricates a Security
    // surface finding here (Concern Matrix consistently reports "Security surface: NONE"). The
    // real, 8/8-reproducible failure is duplication *within* Coupling: the FastifyReply import
    // and its use in `priceOrder`'s signature get reported as two separate CRITICAL findings for
    // one root cause, alongside the genuinely separate DI-instantiation violation in service.ts.
    name: "does not split the FastifyReply leak into duplicate findings alongside the unrelated DI violation",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "reports the FastifyReply import and its use in `priceOrder`'s signature as ONE finding citing both lines, not as two separate CRITICAL/HIGH findings for the same root cause",
      "does not invent a runtime-bug or Security-surface finding for the optional `reply?: FastifyReply` parameter — the import already covers it under Coupling/inward-only-dependencies",
      "stays scoped to structural/layering/DI findings and does not comment on naming, style, or test coverage",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "merges an outer-layer type's import and its same-function signature use into one finding",
    kind: "quality",
    prompt: FASTIFY_LEAK_PROMPT,
    practices: [
      "flags the domain file importing and using `FastifyReply` as a violation of the inward-only dependency rule",
      "reports the import and the `reply?: FastifyReply` parameter as ONE finding citing both lines, not as two separate findings for the same root cause",
      "does not invent a second, independent finding about the unused parameter framed as a runtime bug or security issue",
      "the final gate verdict is FAIL",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites the DevDigest-specific rule identifier for reviewer-core violations",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` gate before emitting findings",
      "names the exact documented rule identifier `reviewer-core-zero-io` for the fs-import finding rather than only describing it in prose",
      "names the exact documented rule identifier `reviewer-core-ground-findings-gate` for the skipped-gate finding rather than only describing it in prose",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the benign rename (or records only `info`-level, non-blocking observations) — it does not invent a critical/high/medium finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the final gate verdict is PASS",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
