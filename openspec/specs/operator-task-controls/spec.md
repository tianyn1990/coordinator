# operator-task-controls Specification

## Purpose

定义 `coordinator` 第一版 operator-only task controls 契约：系统必须允许 operator 通过 Web/API/CLI 暂停、恢复、取消或请求 retry task，同时保持这些动作不进入 Coordinator Agent surface，不绕过 Core gate，不直接清理外部副作用资源。
## Requirements
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

### Requirement: Web V2 Run Until Blocked 必须提供 observation-aware stop reason

系统 SHALL 在 Web V2 `Run until blocked` banner 中使用 task detail、daemon tick summary 和 workflow runtime observation 派生 operator-only stop reason；该 stop reason 只用于展示，不得写入 Core DB 或改变 task status。

#### Scenario: observing runtime stop reason

- **WHEN** task-scoped run 后当前 task 的 workflow runtime observation 为 `observing-runtime`
- **THEN** banner 展示 stop kind 为 observing-runtime
- **AND** banner 说明当前等待 workflow runtime / inner agent 或后续 handoff
- **AND** Web 不提示 operator 输入 workflow 内部 action 参数

#### Scenario: waiting operator gate stop reason

- **WHEN** task-scoped run 后当前 task 的 workflow runtime observation 为 `waiting-operator-gate`
- **AND** observation 包含 operator-facing workflow action
- **THEN** banner 展示 stop kind 为 waiting-operator-gate
- **AND** Web 不自动调用 workflow action endpoint

#### Scenario: handoff ready stop reason

- **WHEN** task-scoped run 后 current workflow run 已产生 handoff
- **THEN** banner 展示 stop kind 为 handoff-ready
- **AND** 后续 PR/MR、review 或 merge flow 仍由 Core/API gate 决定

#### Scenario: recovery attention stop reason

- **WHEN** Core diagnosis 或 workflow runtime observation 表示 recovery attention
- **THEN** banner 展示 stop kind 为 recovery-attention
- **AND** Web 不展示 provider raw output、lock token 或完整 operation JSON

### Requirement: Web V2 Run Until Blocked 必须隔离 task-scoped 与 global 结果

系统 SHALL 明确区分 task-scoped run 和 global run 的展示结果；global run 的其他 task 失败、attention 或 no-candidate 不得污染当前 Focus Drawer task 的 owner/mode 或 blocker。

#### Scenario: task-scoped run 只展示目标 task 结果

- **WHEN** operator 从 Focus Drawer 对某 task 触发 `Run task`
- **THEN** Web 每轮以该 task id 调用 daemon tick loop
- **AND** banner 停止原因只基于该 task detail 与本轮 tick summary

#### Scenario: global run 只展示 queue summary

- **WHEN** operator 从 Command Bar 触发 `Run queue`
- **THEN** Web 展示 global scope、tick count 和 action summary
- **AND** 当前 Focus Drawer task detail 不因其他 task 的失败或 attention 被改写

#### Scenario: no-candidate 与 max-ticks 明确展示

- **WHEN** global run 没有可安全推进的 daemon action
- **THEN** banner 展示 stop kind 为 no-candidate
- **AND** 如果达到安全轮数上限，banner 展示 stop kind 为 max-ticks

### Requirement: Web V2 Run Until Blocked 不得扩大 workflow action surface

系统 SHALL 保持 `Run until blocked` 为 operator-only loop，只调用 daemon tick、refresh 和只读状态查询；即使 banner 停在 operator gate，Web 也不得自动确认该 gate。

#### Scenario: internal action 不触发 workflow action endpoint

- **WHEN** run 后 latest workflow projection 只包含 agent/internal 或 debug-only action
- **THEN** Web 不调用 `/workflow-runs/:id/actions`
- **AND** Web 不根据 actionInputHints 自动构造 action 参数

#### Scenario: operator gate 仍需显式点击

- **WHEN** run 后 latest workflow projection 包含 operator-facing workflow gate
- **THEN** banner 可以提示 waiting-operator-gate
- **AND** 只有 operator 在 Focus Drawer gate panel 中显式提交时，Web 才调用既有 Core workflow action API

