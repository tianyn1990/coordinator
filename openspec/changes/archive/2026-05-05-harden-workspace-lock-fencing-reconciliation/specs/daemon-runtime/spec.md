## ADDED Requirements

### Requirement: daemon 必须执行 workspace/lock read-only observation
系统 SHALL 在 tick 中对 active workspace 与 expired lock 执行只读 observation，并将 observation 交给 Core recovery service。

#### Scenario: active workspace inspected by daemon
- **WHEN** 存在 active workspace
- **THEN** daemon 执行只读 workspace inspect
- **AND** daemon 不直接修改 workspace 语义

#### Scenario: expired lock inspected by daemon
- **WHEN** 存在 expired lock
- **THEN** daemon 检查 owner/resource 是否仍 active
- **AND** daemon 不在没有 Core decision 的情况下释放 lock

### Requirement: daemon 只能按 Core decision 释放 expired lock
系统 SHALL 仅在 Core decision 明确允许且 lock leaseVersion 仍匹配时释放 expired lock。

#### Scenario: leaseVersion changed before release
- **WHEN** Core 曾允许释放 expired lock
- **AND** release 前 lock leaseVersion 已变化
- **THEN** daemon 不释放 lock
- **AND** 记录 recovery event 或跳过动作
