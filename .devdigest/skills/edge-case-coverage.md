# Edge Case Coverage Checker

Look for common missing edge cases in the test diff.

## Empty / zero / null
- Array inputs: is there a test with [] input?
- String inputs: is there a test with '' input?
- Numeric inputs: is there a test with 0 and negative values?

## Boundary
- Off-by-one: n-1, n, n+1 around known limits.
- Pagination: first page, last page, page beyond end.

## Async / concurrency
- Parallel mutations without a test that races two operations.
- Timeout / retry: is there a test that simulates the timeout path?