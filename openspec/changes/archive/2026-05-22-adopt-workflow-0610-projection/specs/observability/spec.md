## ADDED Requirements

### Requirement: Workflow Lens 必须消费 adapter 持久化的 0.6.10 projection

系统 SHALL 允许 Web Workflow Lens 从 Core/API 返回的 workflow event payload 中展示 workflow 0.6.10 projection，包括 `progress` 和 `stageArtifacts`。Web MUST NOT 为展示这些字段直接调用 workflow protocol、读取 `.workflow` private state、读取 artifact 文件内容或推导外层状态。

#### Scenario: 展示 adapter 持久化的新 projection

- **WHEN** workflow event payload 包含 `progress` 和 `stageArtifacts`
- **THEN** Workflow Lens 展示 progress label/summary 与 stage artifact 引用
- **AND** 缺失 `progress` 或 `stageArtifacts` 时继续使用既有 fallback

#### Scenario: stage artifact 只作为引用展示

- **WHEN** Workflow Lens 展示 `stageArtifacts`
- **THEN** Web 只展示 kind、label、path 或 required-for-handoff 摘要
- **AND** Web 不读取 artifact 文件正文，不把相对路径解析为 `.workflow` private state
