## ADDED Requirements

### Requirement: Operator workflow action 必须由 Core 基于 latest status 校验

系统 SHALL 提供 operator-facing workflow action helper，用于把 Web/operator intent 转换为受控 `workflow protocol action` 调用。helper MUST 在执行副作用前重新 inspect workflow run latest status，并校验 expected workflow run state version、allowed action、denied action 与 action input hint；校验失败时不得调用 `workflow protocol action`。

#### Scenario: allowed 无参 action 被执行

- **WHEN** operator 提交 workflow run id、expected state version 与 action `freeze-requirements`
- **AND** latest workflow status 返回 lifecycle active、handoff unavailable、allowedActions 包含 `freeze-requirements`
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
- **THEN** Core 拒绝请求并提示当前仅支持 0 或 1 个 string arg
- **AND** 不通过 Core/API/Web 传递复杂 JSON 参数

#### Scenario: operator workflow action 不进入自动推进路径

- **WHEN** operator-facing workflow action helper 已实现
- **THEN** Coordinator Agent Surface available tools 不包含 workflow action helper 或 API endpoint 名称
- **AND** daemon 不得因为 allowedActions 或 actionInputHints 自动调用该 helper
