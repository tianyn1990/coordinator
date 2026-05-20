## MODIFIED Requirements

### Requirement: workflow status 只能按 protocol handoff 推进外层 workflow run

系统 SHALL 只用 lifecycle/handoff/artifacts/recovery/summary 更新外层 workflow run 粗粒度状态；stage/substate/gate/allowedActions/deniedActions/actionInputs 只能用于 operator debug/display event payload。

#### Scenario: active workflow 有 allowed action 但无 handoff

- **WHEN** workflow protocol status 返回 lifecycle active
- **AND** handoff unavailable
- **AND** allowedActions 或 actionInputs 非空
- **THEN** workflow run 仍保持 running
- **AND** coordinator 不把这些 debug hint 转换为 agent-facing tool
- **AND** daemon 不自动执行 workflow action

### Requirement: 系统必须支持 action/artifacts/events 查询

系统 SHALL 支持 `workflow protocol action --run <run-id> <action>`、`artifacts --run <run-id>`、`events --run <run-id>`，并记录外层 event。operator-only workflow inspect/action 入口 MAY 持久化状态 snapshot 或审计 event，因此它们不是纯读高频 polling API。

#### Scenario: operator-only workflow action 不进入 daemon 自动推进路径

- **WHEN** operator 使用 workflow action 调试入口
- **THEN** 系统可以执行 protocol action 并记录审计 event
- **AND** 该能力不得进入 Coordinator Agent Surface
- **AND** daemon 不得因为 running workflow 的 allowedActions 自动调用该入口
