## ADDED Requirements

### Requirement: 系统必须提供 operator-only task controls

系统 SHALL 提供 pause、resume、cancel、retry 四类 task control，并且这些 control 只能由 operator surface 调用，不得进入 Coordinator Agent `available_tools`。

#### Scenario: operator 暂停 task

- **WHEN** operator 对可暂停 task 提交 pause 请求并携带 expected task state version
- **THEN** Core 将 task 状态更新为 `paused`
- **AND** 系统写入 `operator.task_paused` event
- **AND** Coordinator Surface 不暴露 `pause_task`

#### Scenario: operator 恢复 paused task

- **WHEN** operator 对 `paused` task 提交 resume 请求并携带 expected task state version
- **THEN** Core 将 task 状态更新为 `resuming`
- **AND** 系统写入 `operator.task_resumed` event
- **AND** 后续推进仍由 daemon 基于最新 Coordinator Surface 执行

#### Scenario: operator 取消 task

- **WHEN** operator 对非 terminal task 提交 cancel 请求并携带 expected task state version
- **THEN** Core 将 task 状态更新为 `canceled`
- **AND** 系统写入 `operator.task_canceled` event
- **AND** 系统不默认删除 workspace、关闭 PR/MR 或清理 artifact

#### Scenario: operator 请求 retry

- **WHEN** operator 对允许 retry 的 task 提交 retry 请求并携带 expected task state version
- **THEN** Core 将 task 状态更新为 `resuming`
- **AND** 系统写入带 dueAt 的 `operator.task_retry_requested` event
- **AND** daemon 后续 tick 才能继续推进该 task

### Requirement: task controls 必须通过 Core gate 校验

系统 SHALL 对每个 task control 执行 task 存在性、expected state version、terminal state 和当前状态合法性校验；校验失败不得产生状态变化。

#### Scenario: 使用过期 task version

- **WHEN** operator 使用过期 expected state version 提交 task control
- **THEN** 系统拒绝请求
- **AND** 不写入对应 operator control event

#### Scenario: 对 terminal task 执行 pause/resume/retry

- **WHEN** operator 对 `completed`、`handoff`、`canceled` 或 `failed` task 执行 pause、resume 或 retry
- **THEN** 系统拒绝请求
- **AND** task 状态保持不变

#### Scenario: 对等待人工审批的 task 执行 retry

- **WHEN** operator 对 `waiting_human`、`waiting_review` 或 `waiting_merge_approval` task 执行 retry
- **THEN** 系统拒绝请求
- **AND** 不绕过 human review 或 merge approval gate

### Requirement: task controls 必须可观测

系统 SHALL 为每个成功的 task control 写入 append-only event，事件必须包含 action、actor、reason、previous status、next status 和 expected state version 摘要。

#### Scenario: 查看 task control timeline

- **WHEN** operator 查看 task timeline
- **THEN** 成功的 pause、resume、cancel、retry 都以 operator event 形式出现
- **AND** event payload 不包含大段正文或复杂嵌套 JSON

### Requirement: task controls 必须提供 API/CLI/Web 入口

系统 SHALL 在 API、CLI 和 Web operator surface 中提供 task controls，并且这些入口都必须调用同一个 Core runtime。

#### Scenario: API 调用 task control

- **WHEN** API 收到 task control 请求
- **THEN** API 调用 Core runtime
- **AND** API 不直接更新 SQLite

#### Scenario: CLI 调用 task control

- **WHEN** operator 通过 CLI 调用 task control
- **THEN** CLI 调用 Core runtime
- **AND** 输出更新后的 task 状态

#### Scenario: Web 调用 task control

- **WHEN** operator 在 Web task detail 中点击 pause、resume、cancel 或 retry
- **THEN** Web 调用 operator-only API
- **AND** 操作成功后刷新 task detail
