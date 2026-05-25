## ADDED Requirements

### Requirement: Observability 必须提供 normalized agent activity timeline

系统 SHALL 在 event timeline 或 operator execution summary 中展示 normalized agent activity 摘要，帮助 operator 理解 agent session 最近活动。该摘要不得包含 provider raw output、完整 transcript、secret、permission internals 或 provider private session 文件。

#### Scenario: timeline 展示 normalized agent event

- **WHEN** agent session completed、failed 或产生可汇总 provider activity
- **THEN** timeline 展示 normalized event kind、summary、severity、last activity time 和 artifact refs
- **AND** timeline 不内联完整 provider raw event payload

#### Scenario: operator summary 展示 agent activity

- **WHEN** operator 查询 task detail 或 execution summary
- **THEN** summary 的 agent sessions 分组展示 provider、status、last activity、latest normalized event 和 final response artifact
- **AND** summary 查询不触发 provider、workflow protocol 或 git inspect

### Requirement: Raw provider events 不得进入 agent-facing observability surface

系统 SHALL 将 raw provider events 保留为 debug artifact 引用。任何进入 Coordinator Agent prompt、Coordinator Surface Markdown 或 agent tool result 的 observability 内容都必须经过摘要化和白名单过滤。

#### Scenario: surface snapshot 包含 agent session 时不泄漏 raw event

- **WHEN** surface snapshot 包含 recent agent session 信息
- **THEN** snapshot 最多包含 provider、session status、artifact refs 和短 activity 摘要
- **AND** snapshot 不包含完整 JSONL、raw stdout/stderr、provider private session path 或 permission object

