## ADDED Requirements

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
- **AND** Web 不调用 `/workflow-runs/:id/action`
- **AND** Web 不根据 workflow `allowedActions` 或 `actionInputs` 自动构造 action 参数

#### Scenario: 停止条件只用于 operator explanation

- **WHEN** Web 判断 run-until-blocked 达到停止条件
- **THEN** Web 展示停止原因和最近 tick summaries
- **AND** 该停止原因不写入 Core DB 作为新状态
- **AND** 后续任务真相仍以 Core task status、events、human requests、PR/MR、workflow run 和 diagnosis 为准
