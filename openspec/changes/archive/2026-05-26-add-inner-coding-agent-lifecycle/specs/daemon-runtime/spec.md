## ADDED Requirements

### Requirement: daemon 必须调度 inner coding agent 生命周期

系统 SHALL 允许 daemon 在 active workflow run 需要 coding agent 可见输出时启动 inner coding agent session。daemon MUST 只启动或观察 provider session，不得因为 `allowedActions`、`actionInputs` 或 gate evidence 自动调用 workflow action。

#### Scenario: 缺少 evidence 时启动 inner session

- **WHEN** workflow run 状态为 running
- **AND** 对应 attempt 存在 ready workspace
- **AND** task/project 存在可用 inner agent provider 配置
- **AND** 当前没有 active inner agent session
- **AND** 当前 workflow gate evidence 不是 ready
- **THEN** daemon 启动一个 inner coding agent session
- **AND** daemon action 摘要记录 inner agent session id

#### Scenario: active inner session 运行中只观察

- **WHEN** workflow run 状态为 running
- **AND** 同一 task 已有 starting 或 running inner agent session
- **THEN** daemon 不启动第二个 inner session
- **AND** daemon 不调用 workflow protocol action

#### Scenario: evidence ready 时等待 operator

- **WHEN** workflow run 存在 operator-facing gate
- **AND** gate evidence 为 ready 且 canSubmit 为 true
- **THEN** daemon 不自动确认该 gate
- **AND** gate 仍只能由 Web/API/CLI operator-only action 提交

### Requirement: inner session 完成后 daemon 必须通过 workflow protocol inspect 对齐状态

系统 SHALL 在 inner session 完成或停止后，通过既有 workflow protocol `status` 做 read-only inspect/reconcile，以刷新 workflow projection 和 handoff。daemon MUST NOT 从 inner final response 自然语言直接推导 task completed、PR readiness、merge readiness 或 workflow handoff。

#### Scenario: inner session 完成后 inspect workflow

- **WHEN** daemon 在 tick 中运行并完成 inner coding agent session
- **THEN** daemon 随后调用 workflow protocol status inspect
- **AND** workflow run coarse status 仍只由 protocol lifecycle/handoff 更新
- **AND** final response 只作为 gate evidence 或 operator observability 使用

#### Scenario: inner session 没有可用 provider 时不回落成 action queue

- **WHEN** workflow run 状态为 running
- **AND** project 没有 inner agent provider 配置
- **THEN** daemon 不把 `allowedActions` 全部转成 human request
- **AND** daemon 记录 provider/config 缺失的受控 observation 或 recovery attention
- **AND** daemon 不调用 workflow protocol action

### Requirement: daemon 必须防止重复 inner session

系统 SHALL 使用 active session 检查和稳定 operation idempotency key 防止同一 workflow state/action boundary 被重复启动。operation key MUST 至少区分 task、attempt、workflow run、provider、workflow state version 与最近 workflow action boundary。

#### Scenario: 同一 boundary 已处理不重复启动

- **WHEN** 同一 workflow run state version 和最近 workflow action boundary 已有 terminal inner session operation
- **THEN** 后续 daemon tick 不再次启动 inner provider
- **AND** 系统记录 skipped/no-op 摘要

#### Scenario: 新 workflow action boundary 可重新生成 evidence

- **WHEN** 最近一次 `workflow.action` 之后出现新的 operator gate
- **THEN** daemon 可以基于新的 boundary 启动新的 inner session
- **AND** 旧 final response 不会被当作新 gate 的 ready evidence
