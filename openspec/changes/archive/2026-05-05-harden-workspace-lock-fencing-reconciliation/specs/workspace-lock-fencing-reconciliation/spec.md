## ADDED Requirements

### Requirement: Core 必须拥有 workspace/lock/fencing 恢复决策
系统 SHALL 将 workspace、branch、artifact root、ownership manifest 与 lock/lease/fencing 的恢复观察转换为 Core-owned `RecoveryDecision`，daemon 只能执行 Core 允许的下一步动作。

#### Scenario: daemon 通过 Core 获取 workspace 恢复决策
- **WHEN** daemon 观察到 workspace 或 lock 需要恢复
- **THEN** daemon 将窄 observation 传给 Core recovery service
- **AND** Core 返回有限 `RecoveryDecision`
- **AND** daemon 只执行该 decision 声明的 action

#### Scenario: daemon 不直接接管 workspace 语义
- **WHEN** workspace path、branch、manifest 或 dirty 状态异常
- **THEN** daemon 不自动清理、重建、切换 branch 或继续副作用
- **AND** Core 决定 retry、block、release expired lock 或 operator attention

### Requirement: workspace inspect 必须覆盖路径、branch、dirty 和 manifest 风险
系统 SHALL 在恢复前只读检查 workspace path、repo path、artifact root、branch、git status、ownership manifest 和 checkpoint artifact，并将结果归类为窄 observation。

#### Scenario: workspace path missing
- **WHEN** workspace record 为 active 但 workspace path 不存在
- **THEN** observation 标记为 `missing`
- **AND** Core 不得静默继续执行 workspace 副作用

#### Scenario: branch mismatch
- **WHEN** 当前 git branch 与 workspace record 不一致
- **THEN** observation 标记为 `branch_mismatch`
- **AND** Core 进入 operator attention

#### Scenario: dirty unknown
- **WHEN** git status 显示 dirty 且没有已确认 evidence artifact 表明这是预期变化
- **THEN** observation 标记为 `dirty_unknown`
- **AND** Core 进入 operator attention

#### Scenario: manifest mismatch
- **WHEN** ownership manifest 与 workspace record 不匹配
- **THEN** observation 标记为 `manifest_mismatch`
- **AND** Core 不得自动接管该 workspace

#### Scenario: path escape
- **WHEN** workspace、repo、coordinator 或 artifact root 的 realpath 逃逸允许 root
- **THEN** observation 标记为 `path_escape`
- **AND** Core 进入 operator attention

### Requirement: expired lock 必须 inspect-before-release
系统 SHALL 在释放或接管 expired lock 前先检查 owner/resource 状态，并由 Core 基于 observation、CAS、leaseVersion 和 fencing 规则决定下一步。

#### Scenario: expired lock resource safe to release
- **WHEN** lock 已过期，且 resource observation 表明没有 active owner、没有 active operation，并且 workspace observation 安全
- **THEN** Core 可以返回 `release_expired_lock`
- **AND** daemon 只在 CAS/leaseVersion 仍匹配时释放 lock

#### Scenario: expired lock owner still active
- **WHEN** lock 已过期，但 owner 仍有 active agent session、workflow run 或 operation
- **THEN** Core 不得释放 lock
- **AND** Core 返回 operator attention 或 block

#### Scenario: expired lock resource unsafe
- **WHEN** lock 已过期，但 workspace observation 为 branch mismatch、dirty unknown、manifest mismatch 或 path escape
- **THEN** Core 不得释放 lock
- **AND** Core 进入 operator attention

### Requirement: stale lock token 必须被 fencing 拒绝
系统 SHALL 对所有带副作用操作校验当前 lock token；旧 owner 使用 stale token 时必须被拒绝。

#### Scenario: stale workspace lock token rejected
- **WHEN** workspace lock 已被续租或接管
- **AND** 旧 owner 使用旧 lock token 更新 workspace 状态
- **THEN** 系统拒绝该副作用
- **AND** 不改变 workspace machine truth

### Requirement: workspace/lock recovery event payload 必须保持窄
系统 SHALL 为 workspace/lock recovery 写入 append-only event，payload 只包含审计所需摘要字段和 artifact refs。

#### Scenario: recovery event 不泄漏 lock/manifest 内部字段
- **WHEN** 系统写入 workspace/lock recovery event
- **THEN** payload 包含 resource kind/id、decision、reason code、observed summary、next action 和 artifact refs
- **AND** payload 不包含 lock token、完整 ownership manifest、完整 git output 或完整 operation JSON
