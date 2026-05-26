## ADDED Requirements

### Requirement: Web V2 必须提供 Needs-Me Gate Inbox projection

系统 SHALL 在 Web V2 中使用单一 Needs-Me Gate Inbox projection 驱动 Command Bar count、Run Matrix pin、Focus Drawer gate list 和相关测试定位；该 projection 不得把 workflow agent/internal action、debug-only action、unknown action、raw provider event 或单纯 stage/substate 变化升级为人工 gate。

#### Scenario: operator gate 进入 Needs-Me projection

- **WHEN** task detail 存在 pending human request、pending merge approval、operator-facing workflow gate、Core recovery attention、failed/unknown high-risk state、PR/MR review required/conflict 或 project/provider blocker
- **THEN** Web V2 将该 task 计入 `Needs me`
- **AND** Run Matrix row 显示 needs-me pin
- **AND** Focus Drawer 展示对应 gate item

#### Scenario: internal workflow action 不进入 Needs-Me projection

- **WHEN** task latest workflow projection 只包含 `materialize-change`、`run-alignment-checks`、inspect/resume、unknown 或 debug-only action
- **THEN** Web V2 不将该 task 计入 `Needs me`
- **AND** Focus Drawer 不生成 workflow gate item
- **AND** Workflow Lens 或 Debug Detail 可以展示 sanitized action hint

#### Scenario: projection 不扩大 agent surface

- **WHEN** Web V2 Needs-Me projection 已实现
- **THEN** 任意 Coordinator Surface `available_tools` 不包含 Needs-Me Gate Inbox、Run Matrix pin、Focus Drawer gate item、frontend route 名称或 Web-only action

### Requirement: Web V2 必须用 workflow runtime observation 表达 owner/mode

系统 SHALL 在 Run Matrix row、Focus Drawer 和 Workflow Lens 中使用 Core/API 提供的 workflow runtime observation 或同源 classification fallback 展示 owner/mode；该 observation 只用于 operator explanation，不得成为新的 Core 状态机。

#### Scenario: observing runtime 展示为观察而非阻塞

- **WHEN** task 的 workflow runtime observation 为 `observing-runtime`
- **THEN** Run Matrix owner/mode 表示 workflow runtime 或 inner agent 仍在推进
- **AND** Web V2 不提示 operator 必须执行 workflow action

#### Scenario: waiting operator gate 展示为人工 gate

- **WHEN** task 的 workflow runtime observation 为 `waiting-operator-gate`
- **AND** observation 包含 operator-facing action
- **THEN** Focus Drawer 展示 operator-facing workflow gate
- **AND** Web 仍通过 operator-only Core API 提交确认 intent

#### Scenario: handoff ready 不被 stage/substate 替代

- **WHEN** workflow handoff 已 available
- **THEN** Web V2 将 owner/mode 展示为 handoff-ready 或 Coordinator handoff flow
- **AND** Web 不根据 stage/substate 另行推导 PR readiness、done 或 merge

### Requirement: Web V2 Workflow Lens 必须承接 internal/debug action hint

系统 SHALL 在 Workflow Lens 或 Debug Detail 中展示 internal/debug action 的 sanitized hint，包括 action id、required arg 名称和 usage 摘要；系统 SHALL NOT 在主 gate panel 中展示需要 operator 填内部参数的 action card。

#### Scenario: materialize-change 参数 hint 只进入 Lens

- **WHEN** latest workflow projection 包含 `materialize-change`
- **AND** actionInputHints 指出 required arg 为 `change-id`
- **THEN** Workflow Lens 展示 `materialize-change` 与 `change-id` hint
- **AND** Focus Drawer gate panel 不展示 `change-id` 输入框

#### Scenario: unknown action 保守 debug-only

- **WHEN** latest workflow projection 包含未分类 allowed action
- **THEN** Web V2 只在 Lens 或 Debug Detail 展示该 action
- **AND** Web 不调用 workflow action endpoint

### Requirement: Web V2 不得恢复旧页面级 gate surface

系统 SHALL 保持 Web V2 默认入口为 Run Matrix + Focus Drawer，不得为了 Gate Inbox 或 runtime observation 恢复旧 Action Inbox、Task Cockpit、Classic Debug、New Task 或 Project Admin 页面级 UI。

#### Scenario: Gate Inbox 在 Web V2 单页内展示

- **WHEN** operator 打开 Web V2
- **THEN** Needs-Me Gate Inbox 信息只通过 Command Bar count、Run Matrix pin 和 Focus Drawer gate list 呈现
- **AND** 页面不展示旧 Action Inbox 或 Task Cockpit 页面级导航
