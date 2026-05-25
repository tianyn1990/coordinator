## ADDED Requirements

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

#### Scenario: run banner 不自动执行 workflow action

- **WHEN** run-until-blocked 后当前 task 的 workflow projection 仍存在 allowedActions
- **THEN** banner 可以提示需要 operator workflow action
- **AND** Web 不因 banner 停止原因自动调用 workflow action endpoint
