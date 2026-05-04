## ADDED Requirements

### Requirement: 系统必须持久化 recovery decision event
系统 SHALL 使用 append-only event store 记录 Core recovery decision，事件必须与相关状态变化保持事务一致，并且 payload 只能包含审计所需的窄摘要字段。

#### Scenario: recovery decision 与状态变化同事务提交
- **WHEN** Core recovery decision 改变 operation、workflow run、agent session 或 task 状态
- **THEN** 状态变化和 recovery event 在同一 SQLite transaction 内提交

#### Scenario: recovery decision event payload 保持窄
- **WHEN** 系统写入 recovery decision event
- **THEN** payload 包含 decision、reason code、resource kind/id、operation id、observed summary、next action、retry dueAt 和 artifact refs
- **AND** payload 不包含 provider raw output、secret、lock token 或完整内部对象
