# Uncovered Branch Detector

Review each conditional in the diff and check whether the test suite exercises both sides.

## CRITICAL
- Error handler catch block with no test that triggers the error path.
- Guard clause (early return) with no test for the guard condition.

## WARNING
- Ternary with no test for the false branch.
- Default parameter with no test that omits the argument.

## How to check
Look for describe/it/test blocks in the diff for corresponding assertions.
If no test file exists for a changed source file, escalate to WARNING.