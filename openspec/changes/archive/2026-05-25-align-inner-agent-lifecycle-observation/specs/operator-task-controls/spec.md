## ADDED Requirements

### Requirement: Run Until Blocked 必须消费 workflow runtime observation

系统 SHALL 在 Web `Run until blocked` 停止原因中使用 workflow runtime observation 区分 task-scoped/global scope、observing runtime、waiting operator gate、handoff ready、operator attention 和 terminal 状态。该停止原因只用于 operator explanation，不得写入 Core DB。

#### Scenario: task-scoped run stops at observing runtime

- **WHEN** task-scoped Run Until Blocked 后当前 task 的 workflow run 仍为 running
- **AND** workflow runtime observation 为 observing runtime
- **THEN** banner 说明当前仍在观察 workflow runtime / inner agent
- **AND** banner 不提示 operator 必须执行 workflow action

#### Scenario: task-scoped run stops at operator gate

- **WHEN** task-scoped Run Until Blocked 后当前 task 的 workflow runtime observation 为 waiting operator gate
- **THEN** banner 提示等待 operator-facing workflow gate
- **AND** Web 不因停止原因自动调用 workflow action endpoint

#### Scenario: global run does not pollute current task

- **WHEN** operator 从 Workbench 触发 global Run Until Blocked
- **AND** 其他历史 task 出现 failed 或 attention
- **THEN** 当前打开 task 的 banner 和 detail 仍以当前 task observation 与本次 scope 展示
- **AND** global stop reason 不写入当前 task blocker

