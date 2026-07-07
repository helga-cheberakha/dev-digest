import type {
  OnboardingArtifact,
  OnboardingNode,
} from '@devdigest/shared';

/**
 * Fact set collected deterministically by the service before any LLM call.
 *
 * These are the ground-truth sets the LLM-proposed artifact is checked against.
 * Each set contains identifiers that were verified to actually exist in the repo.
 */
export interface GroundingFactSet {
  /** Relative file paths confirmed to exist in the cloned repository. */
  knownFiles: ReadonlySet<string>;
  /** Package names extracted from the repo's dependency manifests. */
  knownPackages: ReadonlySet<string>;
  /** Service names extracted from docker-compose or equivalent infra facts. */
  knownServices: ReadonlySet<string>;
}

/**
 * Decide whether an architecture diagram node is grounded against the fact set.
 *
 * - `file` nodes: the node `id` must appear in `knownFiles`.
 * - `package` nodes: the node `id` must appear in `knownPackages`.
 * - `service` nodes: the node `id` must appear in `knownServices`.
 * - `overflow` nodes: synthetic; always retained (they represent collapsed surplus,
 *   not a concrete named entity the LLM could have hallucinated).
 */
function isNodeGrounded(node: OnboardingNode, facts: GroundingFactSet): boolean {
  switch (node.kind) {
    case 'file':
      return facts.knownFiles.has(node.id);
    case 'package':
      return facts.knownPackages.has(node.id);
    case 'service':
      return facts.knownServices.has(node.id);
    case 'overflow':
      return true;
  }
}

/**
 * Grounding gate for the LLM-proposed OnboardingArtifact (AC-6).
 *
 * Strips any file/package/service reference that is absent from the
 * deterministically collected fact set before the artifact is returned
 * to the caller. The caller (service, T10) re-validates the result
 * with `OnboardingArtifact.parse()` at the trust boundary — grounding
 * runs first to remove hallucinated references, then re-parse verifies
 * structural validity.
 *
 * Sections affected:
 * - `criticalPaths` — entries with an unknown `file` are discarded.
 * - `readingPath` — entries with an unknown `file` are discarded.
 * - `firstTasks` — tasks with an unknown `suggestedPath` are discarded;
 *   when `firstTasks` is absent the field remains absent.
 * - `architecture.diagram.nodes` — grounded per kind (see `isNodeGrounded`).
 * - `architecture.diagram.edges` — edges whose `from` or `to` no longer
 *   exists in the grounded node set are removed.
 *
 * All other fields (overview, style, howToRun steps, top-level metadata)
 * pass through unchanged; they carry no file/package/service references.
 *
 * Pure, deterministic, no I/O.
 * Do NOT reuse `reviewer-core/src/grounding.ts` — that function grounds
 * findings against diff line numbers and is not applicable here.
 */
export function groundArtifact(
  artifact: OnboardingArtifact,
  facts: GroundingFactSet,
): OnboardingArtifact {
  // --- Architecture diagram -----------------------------------------------

  const groundedNodes = artifact.sections.architecture.diagram.nodes.filter(
    (node) => isNodeGrounded(node, facts),
  );

  const survivingNodeIds = new Set(groundedNodes.map((n) => n.id));

  const groundedEdges = artifact.sections.architecture.diagram.edges.filter(
    (edge) => survivingNodeIds.has(edge.from) && survivingNodeIds.has(edge.to),
  );

  // --- File-reference sections ---------------------------------------------

  const groundedCriticalPaths = artifact.sections.criticalPaths.filter((entry) =>
    facts.knownFiles.has(entry.file),
  );

  const groundedReadingPath = artifact.sections.readingPath.filter((entry) =>
    facts.knownFiles.has(entry.file),
  );

  // firstTasks is optional; preserve absence when the LLM omitted it.
  const groundedFirstTasks =
    artifact.sections.firstTasks !== undefined
      ? artifact.sections.firstTasks.filter((task) =>
          facts.knownFiles.has(task.suggestedPath),
        )
      : undefined;

  // --- Assemble result -----------------------------------------------------

  return {
    ...artifact,
    sections: {
      ...artifact.sections,
      architecture: {
        ...artifact.sections.architecture,
        diagram: {
          nodes: groundedNodes,
          edges: groundedEdges,
        },
      },
      criticalPaths: groundedCriticalPaths,
      readingPath: groundedReadingPath,
      firstTasks: groundedFirstTasks,
    },
  };
}
