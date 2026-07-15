# Secret Leakage Gate

Scan every changed file for hardcoded credentials.

## Patterns to flag as CRITICAL
- String literals matching: sk_live_, sk_test_, AKIA, ghp_, ghs_, xoxb-, xoxp-
- Assignments like password = "...", secret = "...", api_key = "..."
- Base64-encoded blobs of 20+ chars in string literals
- PEM headers (-----BEGIN PRIVATE KEY-----)

## Patterns to flag as WARNING
- Hard-coded localhost URLs with embedded credentials
- .env files accidentally staged

## Exception
Test fixtures with clearly fake keys (e.g. test_key_abc123) are INFO only.