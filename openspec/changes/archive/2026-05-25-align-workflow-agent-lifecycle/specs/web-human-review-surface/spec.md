## MODIFIED Requirements

### Requirement: Web 必须提供 Run Until Blocked 操作体验

系统 SHALL 提供全局和单任务 `Run until blocked` operator 操作，用于循环触发 daemon tick 和 refresh，直到达到安全停止条件。该操作 SHALL 只解释当前 operator-visible 状态，不得把 workflow debug projection 写回 Core DB 成为新 blocker。

#### Scenario: 全局推进安全队列

- **WHEN** operator 从 Workbench 触发全局 `Run until blocked`
- **THEN** Web 循环调用 `/daemon/tick` 并刷新 tasks/detail
- **AND** Web 展示每轮 daemon action summary
- **AND** Web 在没有可安全推进项、达到最大轮数或出现需要 operator/human 介入的事项时停止

#### Scenario: 单任务推进到阻塞

- **WHEN** operator 从 Task Cockpit 或 New Task created task 触发单任务 `Run until blocked`
- **THEN** Web 循环调用 `/daemon/tick` 并刷新该 task detail
- **AND** Web 在该 task terminal、pending human request、pending merge approval、operator-facing workflow gate、workflow handoff ready、operator attention、PR/MR waiting review、failed/unknown 或最大轮数时停止
- **AND** Web 展示停止原因

#### Scenario: workflow running without operator-facing gate 进入观察说明

- **WHEN** task 存在 running workflow run 且没有 handoff
- **AND** latest workflow projection 只包含 agent/internal action 或 unknown action
- **THEN** Web 不把该 workflow action 展示为 needs-me
- **AND** 页面说明 Coordinator 会只读 inspect、等待 workflow runtime / inner agent 或等待 handoff，不会自动执行 workflow action

### Requirement: Task Cockpit 必须提供 Workflow Action Panel

系统 SHALL 在 Task Cockpit 中把 active workflow run 的 operator-facing projection 展示为 Workflow Action Panel。Panel SHALL 只使用 workflow protocol projection 中的 `allowedActions`、`actionInputHints`、`progress` 与 `stageArtifacts` 进行展示，并且只把 Coordinator 侧 classification 为 operator-facing 的 workflow action 展示为可操作卡片，再通过 operator-only API 提交人类确认 intent；Web MUST NOT 直接调用 workflow CLI、直接写 SQLite、把所有 allowedActions 自动转换为 Web Action Card、或把 agent/internal action 放入 needs-me。

#### Scenario: 展示无参 operator-facing workflow action card

- **WHEN** task detail 中 active workflow run 的 latest projection 包含 allowed action `freeze-requirements`
- **AND** 该 action 被分类为 operator-facing
- **AND** 该 action 没有 required arg
- **THEN** Task Cockpit 展示 Workflow Action Panel
- **AND** Panel 显示 stage/progress、stage artifact path 与确认按钮 `Approve requirements and continue`

#### Scenario: 提交无参 workflow action

- **WHEN** operator 点击 `Approve requirements and continue`
- **THEN** Web 调用 `POST /workflow-runs/:workflowRunId/actions`
- **AND** request body 包含 action、expectedStateVersion 与 actor 摘要
- **AND** Web 不调用 `/workflow-runs/:workflowRunId/action` 作为主路径

#### Scenario: operator-facing 一个 string arg 输入

- **WHEN** actionInputHints 指出某 allowed action 需要 1 个 required arg
- **AND** 该 action 被分类为 operator-facing
- **THEN** Panel 展示一个文本输入框，label 使用 required arg 名称
- **AND** operator 提交后 Web 将该输入作为单个 string arg 发送给 Core API

#### Scenario: agent/internal action input 只展示 debug hint

- **WHEN** latest workflow projection 包含 allowed action `materialize-change`
- **AND** actionInputHints 指出该 action 需要 `change-id`
- **THEN** Task Cockpit 不把该 action 放入 Workflow Action Panel 或 Action Inbox
- **AND** Workflow Lens / debug detail 可以展示 sanitized action id、required arg 名称和 usage hint
- **AND** Web 不要求 operator 填写 `change-id`

#### Scenario: unknown action 只展示 debug hint

- **WHEN** latest workflow projection 包含未分类 allowed action
- **THEN** Task Cockpit 不把该 action 放入 Workflow Action Panel 或 Action Inbox
- **AND** Workflow Lens / debug detail 可以展示 sanitized action id 和 actionInputHints
- **AND** Web 不调用 workflow action endpoint

#### Scenario: 多参数 operator-facing action 只展示不可执行提示

- **WHEN** actionInputHints 指出某 operator-facing action 需要超过 1 个 required arg
- **THEN** Panel 展示该 action 当前需要 CLI/workflow 内部处理或后续版本支持
- **AND** Web 不提交复杂 JSON 参数

#### Scenario: action 成功后刷新当前 task 并继续 task-scoped run

- **WHEN** Core API 成功执行 workflow action
- **THEN** Web 刷新当前 task detail
- **AND** Web 可以继续触发当前 task 的 task-scoped `Run until blocked`
- **AND** Web 不自动确认后续出现的其他 workflow action card
