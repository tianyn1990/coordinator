## MODIFIED Requirements

### Requirement: Web Run Until Blocked 必须只使用 operator-safe runtime

系统 SHALL 将 Web `Run until blocked` 实现为 operator-only loop，只调用 daemon tick、refresh 和只读状态查询，不得绕过 Core gate 或 workflow protocol 边界。

#### Scenario: 循环调用 daemon tick

- **WHEN** operator 触发 `Run until blocked`
- **THEN** Web 每轮调用既有 `/daemon/tick` API
- **AND** daemon/Core 决定实际可执行 action
- **AND** Web 展示 daemon 返回的 actions summary

#### Scenario: 不自动执行 workflow action

- **WHEN** daemon tick 后 task 的 workflow run 仍为 running 且没有 handoff
- **THEN** Web 停止或等待下一轮只读 inspect 结果
- **AND** Web 不调用 `/workflow-runs/:id/actions`
- **AND** Web 不根据 workflow `allowedActions` 或 `actionInputs` 自动构造 action 参数

#### Scenario: 停止条件只用于 operator explanation

- **WHEN** Web 判断 run-until-blocked 达到停止条件
- **THEN** Web 展示停止原因和最近 tick summaries
- **AND** 该停止原因不写入 Core DB 作为新状态
- **AND** 后续任务真相仍以 Core task status、events、human requests、PR/MR、workflow run 和 diagnosis 为准

#### Scenario: agent/internal workflow action 不制造 needs-me

- **WHEN** run-until-blocked 后当前 task 的 workflow projection 只存在 `materialize-change`、`run-alignment-checks` 或 unknown action
- **THEN** banner 说明当前处于 observing / waiting runtime
- **AND** Web 不把这些 action 展示为 operator blocker
- **AND** Web 不要求 operator 输入 workflow 内部参数

### Requirement: Web Run Until Blocked 必须区分 task-scoped 与 global 结果展示

系统 SHALL 在 Web `Run until blocked` banner 中明确展示本次 run 的 scope，并将 task-scoped 停止原因与 global run 中其他历史任务的失败区分开。该展示仅用于 operator explanation，不得写入 Core DB 作为新状态，也不得改变 daemon/Core 的候选选择策略。

#### Scenario: task-scoped run 显示当前 task scope

- **WHEN** operator 在 Task Cockpit 触发 `Run until blocked`
- **THEN** Web 只以当前 task id 调用 daemon tick loop
- **AND** banner 明确显示本次 scope 为当前 task
- **AND** 停止原因基于当前 task detail 与本次 tick summary 展示

#### Scenario: global run 显示全局 scope 与分组摘要

- **WHEN** operator 从 Workbench 触发 global `Run until blocked`
- **THEN** banner 明确显示本次 scope 为 global
- **AND** Web 展示本次 tick actions summary
- **AND** 某个历史 task 的失败不得掩盖当前打开 task 的 detail 状态

#### Scenario: run banner 只提示 operator-facing workflow gate

- **WHEN** run-until-blocked 后当前 task 的 workflow projection 存在 allowedActions
- **THEN** banner 只有在存在 operator-facing gate 时才提示需要 operator workflow action
- **AND** Web 不因 banner 停止原因自动调用 workflow action endpoint
