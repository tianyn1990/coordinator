## ADDED Requirements

### Requirement: daemon 必须尊重 operator pause 和 cancel

系统 SHALL 在调度和 retry 时跳过 `paused` 和 `canceled` task；daemon 不得在 operator 暂停或取消后继续启动 Coordinator Agent。

#### Scenario: paused task 不被推进

- **WHEN** task 状态为 `paused`
- **THEN** daemon tick 不启动 Coordinator Agent
- **AND** 不执行 agent tools

#### Scenario: canceled task 不被推进

- **WHEN** task 状态为 `canceled`
- **THEN** daemon tick 不启动 Coordinator Agent
- **AND** 不执行 workflow 或 PR/MR 副作用

### Requirement: daemon 必须基于 operator retry dueAt 推进恢复

系统 SHALL 识别 operator retry event 中的 dueAt，并且只有 dueAt 到期后才允许推进 `resuming` task。

#### Scenario: operator retry 未到期

- **WHEN** task 状态为 `resuming` 且最近的 retry event dueAt 晚于当前时间
- **THEN** daemon tick 不启动 Coordinator Agent
- **AND** 记录 retry not due 的可观测 action

#### Scenario: operator retry 已到期

- **WHEN** task 状态为 `resuming` 且最近的 retry event dueAt 已到期
- **THEN** daemon 可以基于最新 Coordinator Surface 启动 Coordinator Agent
- **AND** daemon 仍必须遵守 retry budget 和 active session 唯一性
