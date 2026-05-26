## ADDED Requirements

### Requirement: Web V2 必须展示 inner agent evidence 而不扩大 action surface

系统 SHALL 在 Focus Drawer / Agent Activity / Workflow Action Panel 中展示 Core 返回的 inner agent activity、final response excerpt 和 gate evidence 状态。Web MUST NOT 因 inner evidence ready、raw provider event、stage/substate 或 internal `allowedActions` 自动执行 workflow action。

#### Scenario: Focus Drawer 显示 inner agent session

- **WHEN** task detail 包含 role 为 `inner` 的 agent session
- **THEN** Web Agent Activity 展示该 session 的 role、provider、status 和 latest activity
- **AND** final response 只作为 artifact ref 或 gate evidence excerpt 展示

#### Scenario: ready evidence 启用 operator gate submit

- **WHEN** workflow operator gate 的 gate evidence 为 ready 且 canSubmit 为 true
- **THEN** Web Workflow Action Panel 可以启用对应 operator-facing action 的提交按钮
- **AND** 提交仍调用 API/Core operator-only workflow action helper

#### Scenario: internal action 仍不进入 needs-me

- **WHEN** Workflow Lens 只包含 `materialize-change`、`run-alignment-checks`、inspect/resume 或 unknown/debug action
- **THEN** Web 不创建 Needs-Me item
- **AND** Web 不展示要求 operator 填写 `change-id` 的 action card
- **AND** inner agent activity 只作为运行证据展示

### Requirement: Web run until blocked 必须等待 inner runtime 或真正 gate

系统 SHALL 将 task-scoped run-until-blocked 的停止解释与 Core/daemon 的 inner lifecycle 对齐：inner agent running 时展示 observing runtime；inner agent completed 后若出现 ready operator gate 才展示 waiting operator gate；evidence missing 时展示 missing evidence，不回退为盲确认。

#### Scenario: inner agent running 时停止为 observing runtime

- **WHEN** task-scoped run-until-blocked 后 task 有 active inner agent session
- **AND** 没有 handoff 或 ready operator gate
- **THEN** Web banner 展示 observing runtime
- **AND** 不把 internal allowed action 显示为 needs-me

#### Scenario: gate evidence missing 时不可提交

- **WHEN** workflow operator gate 存在但 gate evidence missing
- **THEN** Web banner 或 gate panel 展示缺少 coding agent 可见确认依据
- **AND** workflow action submit 按钮保持禁用
