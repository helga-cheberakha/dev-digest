# Mock Overuse Gate

Flag tests where mocking undermines the test's validity.

## CRITICAL
- The module under test is itself mocked.
- Every dependency is mocked, leaving no real code path exercised.
- A mock is set up but never asserted upon when the test's purpose is exactly that interaction.

## WARNING
- Database mocked with a static return — the real DB would reject the input.
- jest.spyOn used to silence real I/O without restoring it (test pollution).