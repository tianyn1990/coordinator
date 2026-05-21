## ADDED Requirements

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
