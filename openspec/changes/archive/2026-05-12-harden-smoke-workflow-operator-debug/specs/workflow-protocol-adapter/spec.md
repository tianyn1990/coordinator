## MODIFIED Requirements

### Requirement: workflow status 只能按 protocol handoff 推进外层 workflow run

系统 SHALL 只用 lifecycle/handoff/artifacts/recovery/summary 更新外层 workflow run 粗粒度状态；stage/substate/gate/allowedActions/deniedActions/actionInputs 只能用于 operator debug/display event payload。

#### Scenario: stage 看似完成但无 handoff

- **WHEN** status 返回 stage 为 review 且 lifecycle 为 active，但 handoff unavailable
- **THEN** workflow run 仍保持 running
- **AND** 系统不生成 pr_ready 或 completed 语义

#### Scenario: status 返回 pr_ready handoff

- **WHEN** status 返回 handoff kind 为 pr_ready
- **THEN** workflow run 状态更新为 handoff
- **AND** handoff kind 保存为 pr_ready

#### Scenario: status 返回 action input hints

- **WHEN** workflow protocol status 返回顶层 `actionInputs`
- **THEN** 系统只解析 action id、required args 和 usage 等窄字段
- **AND** operator-only status 输出可以展示这些 action input hints
- **AND** Coordinator Surface 不得因此新增 agent-facing tool、扩大 available tools 或根据 action input hints 推进外层状态机

### Requirement: 系统必须支持 action/artifacts/events 查询

系统 SHALL 支持 `workflow protocol action --run <run-id> <action>`、`artifacts --run <run-id>`、`events --run <run-id>`，并记录外层 event。operator-only workflow inspect/action 入口 MAY 持久化状态 snapshot 或审计 event，因此它们不是纯读高频 polling API。

#### Scenario: 执行 workflow action

- **WHEN** operator 请求对 workflow run 执行 action
- **THEN** 系统调用 protocol action
- **AND** 按返回 status 更新 workflow run
- **AND** append `workflow.action` event

#### Scenario: 查询 artifacts

- **WHEN** operator 请求查询 workflow artifacts
- **THEN** 系统调用 protocol artifacts
- **AND** 返回只读 artifact 引用

#### Scenario: 查询 events

- **WHEN** operator 请求查询 workflow events
- **THEN** 系统调用 protocol events
- **AND** append `workflow.events_inspected` event

#### Scenario: operator debug 查询不是纯读 polling API

- **WHEN** operator 使用 workflow status/events/action 调试入口
- **THEN** 系统可以记录审计 event 或状态 snapshot
- **AND** 这些入口不得进入 Coordinator Agent Surface
