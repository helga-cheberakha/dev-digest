# Workflow retro ledger

One row per retro run — see `docs/retros/RETRO-*.md` for the full reports.

| date | label | agents (nested) | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|-----------------|------------|-----------|------|-------------|------|--------------------|
| 2026-07-07 | onboarding-generator | 22 (0) | 106k→544k | 92.1% | 2h48m | 1.23x | n/a | split the 37-min T10 orchestrator task — it owned the critical path (T10→T11→T15 ≈ 76 min serialized) |
