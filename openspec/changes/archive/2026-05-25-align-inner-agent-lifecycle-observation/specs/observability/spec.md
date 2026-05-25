## ADDED Requirements

### Requirement: Observability 必须展示 workflow runtime observation 摘要

系统 SHALL 在 operator-only task detail、execution summary 或 timeline 摘要中展示 workflow runtime observation，帮助 operator 区分 observing runtime、waiting operator gate、handoff ready、recovery attention 和 completed/unknown。该摘要必须是只读派生结果，不得成为新的 truth source。

#### Scenario: task detail shows observing runtime

- **WHEN** task detail 的 latest workflow run 为 running
- **AND** latest workflow projection 没有 handoff 且只包含 agent/internal 或 debug-only allowedActions
- **THEN** operator summary 展示当前处于 observing / waiting runtime
- **AND** summary 不生成 needs-me 或 operator blocker

#### Scenario: task detail shows operator gate

- **WHEN** task detail 的 latest workflow run 为 running
- **AND** latest workflow projection 包含 operator-facing allowed action
- **THEN** operator summary 展示 waiting operator gate 与 action 摘要
- **AND** summary 不内联完整 workflow status JSON、actionInputs raw payload 或 `.workflow` private path

#### Scenario: observation remains read-only

- **WHEN** operator 查询 task detail 或 execution summary
- **THEN** 查询不触发 workflow protocol、provider、git 或外部平台 inspect
- **AND** workflow runtime observation 不自动进入 Coordinator Agent Markdown surface

