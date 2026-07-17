# Workflow retro ledger

One row per retro run — see `docs/retros/RETRO-*.md` for the full reports.

| date       | label                | agents (nested)  | in→out tok  | cache hit  | wall  | parallelism  | cost  | top recommendation                                                                                                                                            |
|------------|----------------------|------------------|-------------|------------|-------|--------------|-------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 2026-07-07 | onboarding-generator | 22 (0)           | 106k→544k   | 92.1%      | 2h48m | 1.23x        | n/a   | split the 37-min T10 orchestrator task — it owned the critical path (T10→T11→T15 ≈ 76 min serialized)                                                         |
| 2026-07-07 | why-risk-brief-sdd   | 27 (0)           | 88k→540k    | 93.6%      | 3h10m | 1.12x        | n/a   | give implementation-planner the Edit tool + brief incremental writes — both API connection failures hit its giant single Writes (planner = 62m critical path) |
| 2026-07-15 | multi-agent-review   | 17 (1)           | 9k→373k     | 94.1%      | 2h59m | 0.69x        | $55.33 | apply small well-localized fix batches (e.g. pr-self-review HIGH findings) via direct main-session Edit instead of spawning a fresh implementer |
| 2026-07-15 | export-to-ci         | 20 (0)           | 6.7k→529k   | 93.3%      | 3h42m | 0.84x        | $85.10 | give architecture-reviewer a security lens for generated-artifact diffs — pr-self-review caught a YAML-injection CRITICAL one full review generation after the gate could have |
