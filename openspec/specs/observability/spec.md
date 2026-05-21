# observability Specification

## Purpose
TBD - created by archiving change harden-workflow-observability-boundaries. Update Purpose after archive.
## Requirements
### Requirement: 系统必须提供 operator-only 诊断摘要

系统 SHALL 提供只读派生的 operator diagnosis 或 execution summary，帮助 operator 理解当前 task 的关键状态、最近动作、blocker、recovery 和 artifact refs。该摘要不得成为新的真相源，也不得自动进入 Coordinator Agent Surface。

#### Scenario: 查询 task execution summary

- **WHEN** operator 查询某 task 的 execution summary
- **THEN** 系统从已持久化状态、event、operation 和 artifact refs 派生摘要
- **AND** 摘要按 task、attempt、workspace、agent sessions、coordinator tools、workflow、artifacts 分组
- **AND** 查询不触发 workflow protocol、provider 或 git inspect
- **AND** 摘要不进入 Coordinator Agent Markdown surface

### Requirement: artifact 写入必须可审计

系统 SHALL 记录 coordinator artifact 的受控写入事件，并在 artifact 对当前 tool 非必需时提供 operator 可见的调试信号。

#### Scenario: 额外 artifact 写入可见

- **WHEN** daemon 写入 coordinator artifact
- **AND** 当前 requested tool 不需要 artifact
- **THEN** operator timeline 或 execution summary 可以看到该 artifact 被标记为 extra
- **AND** 系统不把该 extra marker 暴露为 agent-facing tool

### Requirement: Operator diagnosis 可用于 Workbench 展示派生

系统 SHALL 允许 Web Developer Workbench 使用 Core 已提供的 operator-only diagnosis 和 execution summary 派生任务卡片、Action Inbox 和 Classic Debug / 后续系统调试抽屉；这些派生结果不得成为新的真相源，也不得自动进入 Coordinator Agent Surface。

#### Scenario: Workbench 使用 diagnosis 派生 attention item

- **WHEN** Web 查询 task detail 并读取 operator diagnosis
- **THEN** Web 可以基于 `operatorAttention.required` 和 reasons 展示 attention item
- **AND** Web 不展示 provider raw output、secret、lock token、完整 operation JSON 或完整 recovery matrix

#### Scenario: Workbench 使用 timeline 摘要

- **WHEN** Web 需要展示 Classic Debug 或后续系统调试抽屉
- **THEN** Web 可以展示 event type、summary、severity、operation id 和 artifact refs
- **AND** 默认 Workbench 页面不展示完整 raw event payload

#### Scenario: Workbench 派生不进入 agent surface

- **WHEN** Web 形成 task card、mission strip、project rail 或 action inbox
- **THEN** 这些派生展示不改变 Coordinator Surface Markdown 或 `available_tools`
