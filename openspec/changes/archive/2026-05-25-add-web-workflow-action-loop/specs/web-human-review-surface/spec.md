## ADDED Requirements

### Requirement: Task Cockpit 必须提供 Workflow Action Panel

系统 SHALL 在 Task Cockpit 中把 active workflow run 的 operator-facing projection 展示为 Workflow Action Panel。Panel SHALL 只使用 workflow protocol projection 中的 `allowedActions`、`actionInputHints`、`progress` 与 `stageArtifacts` 进行展示，并通过 operator-only API 提交人类确认 intent；Web MUST NOT 直接调用 workflow CLI、直接写 SQLite、或把 allowedActions 自动转换为无人确认的执行。

#### Scenario: 展示无参 workflow action card

- **WHEN** task detail 中 active workflow run 的 latest projection 包含 allowed action `freeze-requirements`
- **AND** 该 action 没有 required arg
- **THEN** Task Cockpit 展示 Workflow Action Panel
- **AND** Panel 显示 stage/progress、stage artifact path 与确认按钮 `Approve requirements and continue`

#### Scenario: 提交无参 workflow action

- **WHEN** operator 点击 `Approve requirements and continue`
- **THEN** Web 调用 `POST /workflow-runs/:workflowRunId/actions`
- **AND** request body 包含 action、expectedStateVersion 与 actor 摘要
- **AND** Web 不调用 `/workflow-runs/:workflowRunId/action` 作为主路径

#### Scenario: 展示一个 string arg 输入

- **WHEN** actionInputHints 指出某 allowed action 需要 1 个 required arg
- **THEN** Panel 展示一个文本输入框，label 使用 required arg 名称
- **AND** operator 提交后 Web 将该输入作为单个 string arg 发送给 Core API

#### Scenario: 多参数 action 只展示不可执行提示

- **WHEN** actionInputHints 指出某 allowed action 需要超过 1 个 required arg
- **THEN** Panel 展示该 action 当前需要 CLI/workflow 内部处理或后续版本支持
- **AND** Web 不提交复杂 JSON 参数

#### Scenario: action 成功后刷新当前 task 并继续 task-scoped run

- **WHEN** Core API 成功执行 workflow action
- **THEN** Web 刷新当前 task detail
- **AND** Web 可以继续触发当前 task 的 task-scoped `Run until blocked`
- **AND** Web 不自动确认后续出现的其他 workflow action card

### Requirement: Workbench task card 必须提供稳定 E2E selector

系统 SHALL 为 Workbench task card 与打开按钮提供稳定的 task id selector 和可访问 label，以支持真实 Web E2E 与 operator accessibility。

#### Scenario: task card 包含 data-task-id

- **WHEN** Workbench 展示 task card
- **THEN** card root 包含 `data-task-id`
- **AND** card root 的 aria-label 包含 task title 摘要

#### Scenario: Open button 包含 task id 与 aria-label

- **WHEN** Workbench 展示 task card 的 Open button
- **THEN** button 包含 `data-action="open-task"` 与 `data-task-id`
- **AND** button 的 aria-label 包含 task title 摘要
