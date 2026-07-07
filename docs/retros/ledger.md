# Workflow retro ledger

One row per retro run — see `docs/retros/RETRO-*.md` for the full reports.

| date | label | agents (nested) | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|-----------------|------------|-----------|------|-------------|------|--------------------|
| 2026-07-07 | onboarding-generator | 22 (0) | 106k→544k | 92.1% | 2h48m | 1.23x | n/a | split the 37-min T10 orchestrator task — it owned the critical path (T10→T11→T15 ≈ 76 min serialized) |
| 2026-07-07 | why-risk-brief-sdd | 27 (0) | 88k→540k | 93.6% | 3h10m | 1.12x | n/a | give implementation-planner the Edit tool + brief incremental writes — both API connection failures hit its giant single Writes (planner = 62m critical path) |
