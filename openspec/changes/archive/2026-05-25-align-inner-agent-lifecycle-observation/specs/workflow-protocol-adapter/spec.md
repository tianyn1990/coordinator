## ADDED Requirements

### Requirement: Adapter 必须派生 operator-only workflow runtime observation

系统 SHALL 在不修改 workflow protocol 的前提下，从 latest workflow status projection、handoff、lifecycle、actionInputHints 和 Coordinator 侧 action classification 派生 operator-only workflow runtime observation。该 observation 只能用于 operator summary、Web 展示、Run Until Blocked explanation 和 daemon observation，不得驱动 task completed、PR readiness、merge、workflow run coarse status 或 Coordinator Agent tool visibility。

#### Scenario: active workflow only internal actions is observing runtime

- **WHEN** workflow protocol status 返回 lifecycle active
- **AND** handoff unavailable
- **AND** allowedActions 只包含 `materialize-change`、`run-alignment-checks`、inspect/resume、实现推进类或 unknown/debug-only action
- **THEN** observation mode 为 observing runtime 或等价摘要
- **AND** owner 为 workflow runtime / inner agent / unknown 的保守表达
- **AND** 系统不把这些 action 视为 operator-facing gate

#### Scenario: active workflow with operator-facing gate waits operator

- **WHEN** workflow protocol status 返回 lifecycle active
- **AND** handoff unavailable
- **AND** allowedActions 包含 Coordinator 侧分类为 operator-facing 的 action
- **THEN** observation mode 为 waiting operator gate 或等价摘要
- **AND** observation 只列出 operator-facing actions 作为可确认 gate
- **AND** agent/internal 和 debug-only action 仍只作为 debug/detail 展示

#### Scenario: observation does not modify protocol contract

- **WHEN** 系统派生 workflow runtime observation
- **THEN** 不要求 workflow protocol 返回 `agent.state`、`blocker.owner`、`operatorActions` 或 `agentActions`
- **AND** adapter 不读取或写入 `.workflow` private state

