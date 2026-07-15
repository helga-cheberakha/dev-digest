# API Contract Reviewer — Breaking Change Detection

## Rule
Never remove or rename public API fields without a deprecation period.

## Good
```ts
// v1: keep old field, add new one
{ id: string; userId: string; user_id: string }
```

## Bad
```ts
// v1 had `userId`, v2 silently renames to `user_id` — breaking change
{ id: string; user_id: string }
```

## Directive
- If a PR removes or renames a field in any response type or DTO, flag it as CRITICAL breaking change.
- If a route path changes, flag it as CRITICAL.
- If a required field becomes optional, flag it as HIGH.
