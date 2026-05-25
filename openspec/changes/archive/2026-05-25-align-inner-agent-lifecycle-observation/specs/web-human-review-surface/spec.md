## ADDED Requirements

### Requirement: Web 必须使用 workflow runtime observation 区分 needs-me 与 observing

系统 SHALL 在 Task Cockpit、Workflow Lens、Action Inbox 和 task card 中使用 Core/API 提供的 workflow runtime observation 或同源 action classification，将 operator-facing gate 与 agent/internal/debug action 分离。Web MUST NOT 因 `allowedActions.length > 0` 直接生成 Action Card、needs-me item 或人工输入表单。

#### Scenario: materialize-change remains debug detail

- **WHEN** task detail latest workflow projection 包含 allowed action `materialize-change`
- **AND** actionInputHints 指出该 action 需要 `change-id`
- **THEN** Task Cockpit 不把该 action 放入 Workflow Action Panel、Action Inbox 或 needs-me
- **AND** Workflow Lens / debug detail 可以展示 sanitized action id、required arg 名称和 usage hint
- **AND** Web 不要求 operator 输入 `change-id`

#### Scenario: operator gate enters action panel

- **WHEN** task detail workflow runtime observation 表示 waiting operator gate
- **AND** observation 包含 operator-facing action `freeze-requirements`
- **THEN** Task Cockpit 展示 Workflow Action Panel
- **AND** Web 仍通过 operator-only Core API 提交确认 intent

#### Scenario: task card does not report internal action as needs me

- **WHEN** Workbench task card 的 workflow observation 为 observing runtime
- **THEN** task card 可以展示 workflow 正在由 runtime / inner agent 继续处理
- **AND** Action Inbox 不为该 task 生成 workflow needs-me item

