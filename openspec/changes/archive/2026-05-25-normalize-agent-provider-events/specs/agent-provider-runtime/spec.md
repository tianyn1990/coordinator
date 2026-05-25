## ADDED Requirements

### Requirement: AgentProvider runtime 必须归一化 provider event

系统 SHALL 将 SDK / CLI provider 输出分层处理为 raw provider event artifact、normalized agent event 摘要和极少 lifecycle signal。normalized event MUST 使用 provider-agnostic 白名单 kind；未知 raw event 不得以内联完整 JSON 进入 Core event payload、Coordinator Surface 或 agent tool 参数。

#### Scenario: SDK raw event 写入 provider events artifact

- **WHEN** SDK adapter 返回 raw provider events
- **THEN** runtime 写入 `provider-events.jsonl` 或兼容 transcript artifact
- **AND** session completed / failed event payload 只包含 artifact ref、event count 和窄摘要
- **AND** event payload 不包含完整 raw JSONL、provider private session path 或 permission internals

#### Scenario: raw event 归一化为白名单摘要

- **WHEN** provider 输出 turn、message、tool、permission、result 或 failure 事件
- **THEN** runtime 将可识别事件映射为 normalized agent event
- **AND** normalized event 只包含 kind、summary、timestamp、severity 和有限 metadata
- **AND** 未识别事件只记录为 unknown/provider event 计数或短摘要

### Requirement: AgentProvider result 必须提供 agent activity 摘要

系统 SHALL 从 provider result、normalized events 和 session artifact 派生 operator-facing `agentActivity` 摘要。该摘要 MAY 进入 Core event payload 和 operator task detail；MUST NOT 直接驱动 task completed、PR readiness、merge readiness 或 workflow handoff。

#### Scenario: session 完成时记录 activity 摘要

- **WHEN** provider session 成功完成
- **THEN** runtime 记录 latest normalized event、last activity time、implementation mode、permission profile、provider session id、provider version 和 artifact refs
- **AND** final response artifact 仍作为 Coordinator Agent 决策输出的主要证据

#### Scenario: session 失败时记录 failure signal

- **WHEN** provider session 失败
- **THEN** runtime 记录 failure kind、latest normalized event、last activity time 和 artifact refs
- **AND** failure signal 只用于 recovery observation 和 operator diagnosis
- **AND** Core 不根据 raw provider event 猜测业务是否已完成

