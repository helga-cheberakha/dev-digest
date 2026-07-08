# Specs — DevDigest cross-module specification

The top level `specs/` directory holds Spec-Driven Development (SDD) specifications for **cross-package features**
— anything that touches two or more packages (e.g. API + UI). 
A feature that lives entirely inside one package belongs in that package's
own `specs/` directory (`server/specs/`, `client/specs/`, `reviewer-core/specs/`, `e2e/specs/`).

## What a spec is

Specs are written by the `spec-creator` agent (see `.claude/agents/spec-creator.md`).

A spec describes what a feature must do and why - the problem, goals / non-goals, user stories,
EARS acceptance criteria, edge cases, cross-module interactions, and contracts. 
It deliberately stops short of how to implement it (file-by-file tasks, layers, code) -
that is the implementation-planner agent's Development Plan (docs/plans/). 
The intended chain is:

> spec-creator → spec (WHAT/WHY) → implementation-planner → plan (HOW) → implementer → code

## Conventions

- File naming = Spec ID: `SPEC-YYYY-MM-DD-<kebab-case-feature>.md` (creation date + feature
  name), e.g. `SPEC-2026-07-06-onboarding-overview.md`.
- Spec ID (in the header line): `SPEC-YYYY-MM-DD-<kebab-case-feature>`
- Every spec follows the fixed template with EARS acceptance criteria and a
  `[NEEDS CLARIFICATION]` section; status lifecycle: `draft` → `approved` → `implemented`.
  spec-creator always creates specs as `draft`; a human reviewer flips the status to
  `approved`; after implementation is verified, the caller (or plan-verifier) flips it to
  `implemented`.
- Specs may contain Mermaid workflow/sequence diagrams and interface-level contracts
  (endpoints, event payloads, field tables) — but no implementation details or code.

A spec that replaces an earlier decision links it via the Supersedes: header line.
