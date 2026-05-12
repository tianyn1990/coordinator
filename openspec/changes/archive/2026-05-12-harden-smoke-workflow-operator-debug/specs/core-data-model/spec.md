## MODIFIED Requirements

### Requirement: 状态变化和事件必须同事务提交

系统 SHALL 在同一 SQLite transaction 内提交关键状态变化和对应 append-only event。SQLite 连接 SHALL 启用 foreign key、WAL，并配置短暂 busy timeout，以降低本机 operator/debug 写入在短暂并发下直接失败的概率。

#### Scenario: 创建 task 并记录事件

- **WHEN** repository 创建 task
- **THEN** 系统在同一事务中写入 task 记录和 task created event

#### Scenario: 短暂并发写入等待

- **WHEN** 本机多个 operator/debug 入口短时间内写入同一 SQLite 数据库
- **THEN** SQLite 连接等待短暂 writer contention
- **AND** 系统仍保持状态变化和 event append 的事务边界
