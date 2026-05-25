## MODIFIED Requirements

### Requirement: Operator workflow action 必须由 Core 基于 latest status 校验

系统 SHALL 提供 operator-facing workflow action helper，用于把 Web/operator intent 转换为受控 `workflow protocol action` 调用。helper MUST 在执行副作用前重新 inspect workflow run latest status，并校验 expected workflow run state version、action classification、allowed action、denied action 与 action input hint；校验失败时不得调用 `workflow protocol action`。系统 MUST 将 `materialize-change`、`run-alignment-checks`、repair/current-change、inspect/resume、实现推进类和未知 action 视为非 operator-facing，除非后续规格显式允许。

#### Scenario: operator-facing 无参 action 被执行

- **WHEN** operator 提交 workflow run id、expected state version 与 action `freeze-requirements`
- **AND** latest workflow status 返回 lifecycle active、handoff unavailable、allowedActions 包含 `freeze-requirements`
- **AND** action classification 为 operator-facing
- **AND** actionInputHints 中该 action 没有 required arg
- **THEN** Core 调用既有 workflow action adapter 执行 `workflow protocol action`
- **AND** 系统记录 `workflow.action` event 与 operation 审计

#### Scenario: action 不在 latest allowedActions 时拒绝

- **WHEN** operator 提交某 workflow action
- **AND** latest workflow status 的 allowedActions 不包含该 action
- **THEN** Core 拒绝请求
- **AND** 不调用 `workflow protocol action`

#### Scenario: action 在 deniedActions 时拒绝

- **WHEN** operator 提交某 workflow action
- **AND** latest workflow status 的 deniedActions 包含该 action
- **THEN** Core 拒绝请求
- **AND** 不调用 `workflow protocol action`

#### Scenario: required arg 缺失或过多时拒绝

- **WHEN** latest workflow status 的 actionInputHints 指出该 action 需要 1 个 string arg
- **AND** operator 未提供 arg
- **THEN** Core 拒绝请求
- **AND** 不调用 `workflow protocol action`

#### Scenario: 第一版不接受复杂 action inputs

- **WHEN** latest workflow status 的 actionInputHints 指出该 action 需要超过 1 个 required arg
- **THEN** Core 拒绝请求并提示当前仅支持 operator-facing action 的 0 或 1 个 string arg
- **AND** 不通过 Core/API/Web 传递复杂 JSON 参数

#### Scenario: agent/internal action 被 operator endpoint 拒绝

- **WHEN** operator 提交 workflow run id、expected state version 与 action `materialize-change`
- **AND** latest workflow status 返回 allowedActions 包含 `materialize-change`
- **AND** actionInputHints 指出该 action 需要 `change-id`
- **THEN** Core 拒绝请求并说明该 action 不是 operator-facing gate
- **AND** 不调用 `workflow protocol action`

#### Scenario: unknown action 被保守拒绝

- **WHEN** operator 提交 workflow run id、expected state version 与未分类 action
- **AND** latest workflow status 返回 allowedActions 包含该 action
- **THEN** Core 拒绝请求并说明该 action 当前仅可作为 debug/detail 展示
- **AND** 不调用 `workflow protocol action`

#### Scenario: operator workflow action 不进入自动推进路径

- **WHEN** operator-facing workflow action helper 已实现
- **THEN** Coordinator Agent Surface available tools 不包含 workflow action helper 或 API endpoint 名称
- **AND** daemon 不得因为 allowedActions 或 actionInputHints 自动调用该 helper

## ADDED Requirements

### Requirement: CLI workflow action 必须保持低层 operator/debug 边界

系统 MAY 保留既有 CLI `workflow action` 低层调试入口，用于显式 operator/debug 排障。该入口必须继续通过 Core adapter、operation ledger、lock 和 workflow protocol action 执行；它 MUST NOT 进入 Web Action Inbox、Task Cockpit Workflow Action Panel、daemon 自动推进路径或 Coordinator Agent Surface。该入口的存在不得被解释为 Coordinator 可以自动执行 agent/internal workflow action。

#### Scenario: CLI debug action 不扩大 Web 或 Agent Surface

- **WHEN** CLI `workflow action` 入口存在
- **THEN** Web Action Panel 和 Action Inbox 仍只展示 operator-facing gate
- **AND** Coordinator Agent Surface available tools 不包含 workflow action executor
- **AND** daemon 不调用 CLI 或底层 action adapter 自动推进 workflow action
