## ADDED Requirements

### Requirement: PR/MR recovery 不得扩大 Coordinator Agent surface

系统 SHALL 保持 PR/MR 与 merge recovery 为 Core/runtime 内部恢复能力或 operator-only observability，不得因此新增 agent-facing recovery tool，也不得暴露复杂内部字段。

#### Scenario: 不新增 PR/MR recovery agent tool

- **WHEN** PR/MR recovery 或 merge reconciliation 能力启用
- **THEN** Coordinator Surface 不包含 `recover_pr`、`reconcile_merge`、`force_merge` 或 provider-specific debug tool
- **AND** surface 仍只暴露当前状态允许的既有 agent tools

#### Scenario: surface 不泄漏内部恢复细节

- **WHEN** PR/MR recovery event、provider failure 或 approval invalidation 被写入
- **THEN** Coordinator Surface 可以展示人类可读摘要和 artifact refs
- **AND** Markdown 和 available tools 不包含 provider raw output、完整 operation JSON、完整 approval object、lock token 或复杂 JSON 参数
