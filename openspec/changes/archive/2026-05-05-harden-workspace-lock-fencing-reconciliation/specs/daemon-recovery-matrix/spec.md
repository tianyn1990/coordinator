## ADDED Requirements

### Requirement: recovery matrix 必须覆盖 workspace/lock observation
系统 SHALL 将 workspace/lock/fencing observation 纳入 Core recovery matrix，并保持 `Observation -> Core RecoveryDecision -> Daemon Action`。

#### Scenario: workspace observation 进入 Core decision
- **WHEN** daemon 观察到 active workspace 需要恢复
- **THEN** daemon 将 workspace observation 传给 Core
- **AND** Core 返回 workspace/lock recovery decision

#### Scenario: lock observation 进入 Core decision
- **WHEN** daemon 观察到 expired lock
- **THEN** daemon 先 inspect owner/resource 状态
- **AND** Core 基于 observation 决定是否释放、阻塞或 operator review

### Requirement: workspace/lock recovery 不得扩大 agent surface
系统 SHALL 保持 workspace/lock recovery 为 internal daemon action 或 operator-only observability，不得新增 Coordinator Agent recovery tool。

#### Scenario: 不新增 agent recovery tool
- **WHEN** workspace/lock recovery 能力启用
- **THEN** Coordinator Surface 不包含 `release_lock`、`recover_workspace`、`reconcile_workspace` 或 `takeover_lock`
