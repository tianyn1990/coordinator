## ADDED Requirements

### Requirement: AgentProvider runtime 必须保留 operator-visible message evidence

系统 SHALL 将 SDK-first provider 输出分为 raw event artifact、normalized activity 和 operator-visible message evidence。operator-visible message evidence MAY 来自 final response artifact、assistant message item 或 provider-approved visible message summary；hidden chain-of-thought、provider private state、permission internals 和完整 raw JSONL MUST NOT 进入 evidence。

#### Scenario: inner agent final response 可作为 evidence

- **WHEN** inner coding agent session 通过 SDK provider 完成并写入 final response artifact
- **THEN** Core 可以把该 final response 的受限摘要作为 workflow gate evidence 主消息
- **AND** evidence 只引用 transcript/raw event artifact，不内联完整 raw JSONL

#### Scenario: raw event 不成为 gate evidence 主内容

- **WHEN** SDK stream 输出 tool call、command output、reasoning、permission 或 provider raw event
- **THEN** runtime 只把它们写入 transcript/provider event artifact 或 normalized activity 摘要
- **AND** gate evidence 不默认展示这些 raw event 正文
