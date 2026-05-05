## ADDED Requirements

### Requirement: 系统必须提供 PR/MR 外部事实 inspect

系统 SHALL 通过 PR/MR provider 提供 read-only inspect 能力，将 GitHub/GitLab/Fake 的平台输出转换为有限外部事实，并由 Core 解释这些事实。

#### Scenario: inspect 返回 open snapshot

- **WHEN** provider inspect 一个 open PR/MR
- **THEN** provider 返回 external id、url、head/base branch、head/base sha、review status、validation run、mergeable 和 summary
- **AND** 返回内容不包含 provider raw output

#### Scenario: inspect 返回 terminal 状态

- **WHEN** provider inspect 到 PR/MR closed unmerged 或 merged
- **THEN** provider 用有限 state 表达结果
- **AND** Core 决定是否 operator attention、reconcile 或 completed

### Requirement: 系统必须在 provider failure 中保留可恢复分类

系统 SHALL 在 PR/MR provider inspect/create/update/merge 失败时持久化窄 failure classification，供 operation replay 和 operator diagnosis 使用。

#### Scenario: provider failure 分类

- **WHEN** provider 抛出 timeout、rate limit、auth missing、conflict、malformed output 或 unknown failure
- **THEN** 系统记录窄 failure code
- **AND** operation 不保存 provider raw output

#### Scenario: retryable failure 不推进状态

- **WHEN** provider failure 被分类为 retryable
- **THEN** 系统不得推进 PR/MR、approval 或 task 到成功状态
- **AND** 后续必须通过 retry/reconcile 再决定
