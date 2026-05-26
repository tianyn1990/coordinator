## ADDED Requirements

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
