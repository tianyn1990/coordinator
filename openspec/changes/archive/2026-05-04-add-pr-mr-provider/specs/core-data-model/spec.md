## ADDED Requirements

### Requirement: 系统必须持久化 PR/MR 与 merge approval machine truth
系统 SHALL 在 SQLite 中持久化 pull request、review snapshot、merge approval、相关 operation 和 event，以支撑 PR/MR 创建、更新、审批、merge 和恢复。

#### Scenario: create PR/MR record
- **WHEN** 系统创建 PR/MR
- **THEN** 系统保存 provider kind、external id、url、head/base branch、head/base sha、status

#### Scenario: approval snapshot
- **WHEN** 系统记录 merge approval
- **THEN** 系统保存 pr_id、head_sha、base_sha、validation_run_id、merge_strategy、approved_by、approved_at 和有效性

#### Scenario: active merge operation uniqueness
- **WHEN** 同一 PR 存在 active merge operation
- **THEN** 数据库约束防止并发重复 merge

