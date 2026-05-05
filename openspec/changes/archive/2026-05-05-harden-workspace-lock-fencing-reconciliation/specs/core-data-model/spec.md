## ADDED Requirements

### Requirement: lock recovery 必须支持 leaseVersion fencing
系统 SHALL 支持按 resource kind/id、lock token 和 leaseVersion 进行 lock recovery release，避免释放已被续租或接管的新 lock。

#### Scenario: release expired lock with matching lease
- **WHEN** Core decision 允许释放 expired lock
- **AND** 当前 lock token 与 leaseVersion 仍匹配
- **THEN** 系统释放该 lock

#### Scenario: release expired lock with stale lease
- **WHEN** release 请求携带的 leaseVersion 已过期
- **THEN** 系统拒绝释放
- **AND** 当前 lock 保持不变

### Requirement: workspace/lock recovery event 必须与状态变化同事务提交
系统 SHALL 在释放 expired lock、标记 operation unknown 或进入 operator attention 时，将状态变化和 recovery event 在同一 SQLite transaction 内提交。

#### Scenario: lock release recovery event
- **WHEN** 系统按 Core decision 释放 expired lock
- **THEN** lock 删除和 recovery decision event 同事务提交
