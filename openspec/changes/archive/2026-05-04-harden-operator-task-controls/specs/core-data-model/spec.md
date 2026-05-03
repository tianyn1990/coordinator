## ADDED Requirements

### Requirement: task control 状态变化必须与事件同事务提交

系统 SHALL 对 pause、resume、cancel、retry 产生的 task 状态变化和 operator event 使用同一 SQLite transaction 提交。

#### Scenario: task control 成功提交

- **WHEN** Core 成功执行 task control
- **THEN** task 状态和对应 operator event 同时可见
- **AND** event payload 包含 action、actor、reason、previous status、next status 和 expected state version 摘要

#### Scenario: task control 事务失败

- **WHEN** Core 执行 task control 时事务失败
- **THEN** task 状态不应被部分更新
- **AND** 不应产生孤立的 operator event

### Requirement: task control 必须保持 CAS 语义

系统 SHALL 要求 operator task control 输入 expected task state version，并在 version 不匹配时拒绝更新。

#### Scenario: task control CAS 冲突

- **WHEN** operator 使用旧 version 执行 task control
- **THEN** 系统返回受控 conflict
- **AND** task 状态保持不变
