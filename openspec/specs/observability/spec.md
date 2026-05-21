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

### Requirement: Workflow Lens 必须只读展示 workflow protocol 投影

系统 SHALL 允许 Web Task Cockpit 使用 workflow protocol status/artifacts/events 的 operator-only 投影展示 Workflow Lens；这些字段不得成为 Coordinator Core 的 truth source，也不得自动进入 Coordinator Agent Surface。

#### Scenario: 展示 workflow 进度字段

- **WHEN** task detail 或 workflow protocol projection 中存在 workflow profile、lifecycle、stage、substate、gate、progress、handoff、allowedActions、deniedActions、actionInputs 或 stageArtifacts
- **THEN** Workflow Lens 展示这些字段的 operator-readable 摘要
- **AND** Web 明确将 `allowedActions` 和 `actionInputs` 作为 debug/operator 信息展示

#### Scenario: workflow 进度字段缺失

- **WHEN** workflow status 缺少 stage、substate、gate、progress 或 stageArtifacts
- **THEN** Workflow Lens 使用 unknown、none、summary、handoff 或 artifact refs fallback
- **AND** Web 不根据缺失字段伪造 workflow stage、substate 或 handoff

#### Scenario: running workflow 尚未 handoff

- **WHEN** workflow run 正在运行且 handoff 不可用
- **THEN** Workflow Lens 展示 coordinator 正在只读观察 workflow
- **AND** Web 不提示 daemon 或 outer Agent 自动执行 workflow action

### Requirement: Workflow Lens 不得驱动外层状态或自动 action

系统 SHALL 保持 workflow stage/substate/gate/allowedActions/actionInputs 为 debug/display 字段；这些字段不得驱动 Coordinator task status、PR readiness、done、merge、daemon action 或 Coordinator Agent tool visibility。

#### Scenario: 生成外层状态和 surface

- **WHEN** Workflow Lens 展示 stage、substate、gate 或 allowedActions
- **THEN** Coordinator Surface available tools 不因此变化
- **AND** task status、PR readiness、done 和 merge 判断仍由 Core、workflow handoff、PR/MR provider 和 human approval gate 决定

#### Scenario: 展示 action input hints

- **WHEN** Workflow Lens 展示 workflow action input hints
- **THEN** Web 只展示 action id、required args、usage 或短摘要
- **AND** Web 不自动调用 `workflow protocol action`
- **AND** daemon 不把这些 hints 当成 action queue
