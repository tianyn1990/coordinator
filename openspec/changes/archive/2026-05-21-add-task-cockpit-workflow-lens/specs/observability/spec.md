## ADDED Requirements

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
