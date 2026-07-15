# PR Quality Rubric

Evaluate the PR against these dimensions and flag any dimension that scores below threshold.

## Correctness (weight: 40%)
- Logic errors, off-by-one, wrong comparisons, operator precedence.
- Missing null/undefined guards at system boundaries.
- Ownership/tenant checks: any write that persists an ID referencing another entity (ownerId,
  workspaceId, userId, etc.) must be backed by a lookup or scoped query proving that entity
  belongs to the caller's workspace — flag inserts/updates that take such an ID straight from
  request input with no such check.
- Race conditions in async code: flag check-then-act patterns — reading a value, awaiting
  something, then writing the value back — with no lock, transaction, or atomic operation
  between the read and the write.

## Testing (weight: 30%)
- Changed code has corresponding tests.
- Tests exercise the failure path, not just the happy path.
- No mock-only tests that hide real failures: flag any test that mocks the exact module or
  function it claims to test, then asserts against that mock's own hardcoded return value — the
  assertion can never fail regardless of whether the real implementation is correct.

## Documentation (weight: 15%)
- Public API surface has JSDoc or inline comments for non-obvious behavior.
- CHANGELOG / migration guide updated for breaking changes.

## Code clarity (weight: 15%)
- Variable and function names are unambiguous.
- Functions are at a single level of abstraction.
- Magic numbers are named constants.