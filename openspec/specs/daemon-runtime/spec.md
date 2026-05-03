## Purpose
定义 `coordinator` 第一版 P0 Daemon Runtime 契约：系统必须提供最小 daemon tick，用于调度、探活、reconciliation、retry 和 human request wake-up，同时保持 daemon 不是 agent，不做业务语义判断，不绕过 Coordinator Surface、agent tools executor、workflow protocol 或 operation/idempotency 约束。

## Requirements

### Requirement: 系统必须提供最小 daemon runtime
系统 SHALL 提供一个长运行 daemon，用于调度、探活、reconciliation、retry 和 human request 唤醒，并且 daemon 不能替代 Coordinator Agent 的业务决策。

#### Scenario: daemon 启动
- **WHEN** operator 启动 daemon
- **THEN** 系统进入周期性 tick
- **AND** daemon 只读取持久化状态并触发受控恢复动作
- **AND** daemon 不直接修改业务语义以外的核心判断

### Requirement: daemon 必须能够发现并推进可继续任务
系统 SHALL 在每个 tick 中发现可恢复状态，并根据当前 surface、operation 和外部状态决定是否唤醒 Coordinator Agent、检查 workflow run 或触发 retry。

#### Scenario: 发现可继续任务
- **WHEN** 存在需要继续推进的任务
- **THEN** daemon 选择一个候选任务
- **AND** 构建最新 Coordinator Surface
- **AND** 触发对应恢复动作

### Requirement: daemon 必须执行 watchdog 和 reconciliation
系统 SHALL 对 active agent session、workflow run、workspace、human request 和 lock 状态执行 watchdog 与 reconciliation，并在外部状态与数据库不一致时采取受控修复或降级，而不是静默推进完成。

#### Scenario: workflow 运行状态丢失
- **WHEN** workflow run 数据库状态为 running 但外部状态不可用
- **THEN** daemon 将该 run 标记为需要再检查
- **AND** 不把它直接视为 completed
- **AND** 记录恢复事件

### Requirement: daemon 必须支持 human request 唤醒
系统 SHALL 在 human request 被回答后唤醒对应 task，并生成新的 Coordinator Surface 继续推进。

#### Scenario: human answer 到达
- **WHEN** human request 进入 answered 状态
- **THEN** daemon 读取对应 task
- **AND** 唤醒 Coordinator Agent
- **AND** 让后续决策基于最新 surface

### Requirement: daemon 必须遵守 retry budget
系统 SHALL 对可重试失败使用受限 retry budget，并在预算耗尽时转为 handoff、failed 或人工介入，而不是无限重试。

#### Scenario: retry 耗尽
- **WHEN** 同类失败超过 retry budget
- **THEN** daemon 不再自动重试
- **AND** 记录恢复受限原因
- **AND** 触发 handoff 或 human request

### Requirement: daemon 事件必须可观测
系统 SHALL 记录 daemon tick、task claim、reconcile、retry、wake-up 和 failure 事件，以便 UI 和审计追踪。

#### Scenario: 记录 tick 事件
- **WHEN** daemon 执行一次 tick
- **THEN** 系统写入可观测事件
- **AND** 事件包含 tick 级别摘要和受影响资源引用

### Requirement: daemon 必须尊重 operator pause 和 cancel

系统 SHALL 在调度、human wake-up 和 retry 时跳过 `paused` 和 `canceled` task；daemon 不得在 operator 暂停或取消后继续启动 Coordinator Agent。

#### Scenario: paused task 不被推进

- **WHEN** task 状态为 `paused`
- **THEN** daemon tick 不启动 Coordinator Agent
- **AND** 不执行 agent tools

#### Scenario: canceled task 不被推进

- **WHEN** task 状态为 `canceled`
- **THEN** daemon tick 不启动 Coordinator Agent
- **AND** 不执行 workflow 或 PR/MR 副作用

#### Scenario: answered human request 不唤醒 paused task

- **WHEN** human request 已 answered 且 task 状态为 `paused`
- **THEN** daemon tick 不启动 Coordinator Agent
- **AND** human request 保持可见，等待 operator resume 后再处理

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
