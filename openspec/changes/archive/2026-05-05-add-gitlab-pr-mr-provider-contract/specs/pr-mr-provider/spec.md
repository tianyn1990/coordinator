## MODIFIED Requirements

### Requirement: 系统必须支持一个真实 CLI provider 路径和一个 fake provider contract

系统 SHALL 在第一版提供 GitHub 与 GitLab 两套真实 CLI provider 路径，并提供一个 fake provider 作为 contract stub。

#### Scenario: GitHub 真实 provider 通过 CLI 执行

- **WHEN** provider kind 为 GitHub 且配置了 CLI runner
- **THEN** 系统通过 `gh` 的窄命令执行 PR 副作用
- **AND** Core 仍负责 workflow handoff gate、operation/idempotency、approval snapshot 和 merge policy

#### Scenario: GitLab 真实 provider 通过 CLI 执行

- **WHEN** provider kind 为 GitLab 且配置了 CLI runner
- **THEN** 系统通过 `glab` 的窄命令执行 MR 副作用
- **AND** Core 仍负责 workflow handoff gate、operation/idempotency、approval snapshot 和 merge policy

#### Scenario: fake provider 用于测试

- **WHEN** 系统在测试或无外部认证场景运行
- **THEN** 系统可以使用 fake provider 模拟 PR/MR 行为

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

#### Scenario: GitLab inspect 输出被归一化

- **WHEN** GitLab CLI 返回 `source_branch`、`target_branch`、`web_url`、`sha`、`diff_refs`、`head_pipeline`、`merge_status`、`detailed_merge_status` 或 `blocking_discussions_resolved`
- **THEN** provider 将其转换为统一 PR/MR external fact
- **AND** 不将 GitLab raw JSON 暴露给 Core event payload 或 Coordinator Agent surface

### Requirement: 系统必须默认使用 squash merge

系统 SHALL 默认使用 squash merge，且 merge 冲突不能自动绕过。

#### Scenario: GitHub merge 成功

- **WHEN** approval 有效且远端状态一致
- **THEN** 系统通过 GitHub provider 执行 squash merge
- **AND** 记录 merge 结果

#### Scenario: GitLab merge 成功

- **WHEN** approval 有效且远端状态一致
- **THEN** 系统通过 GitLab provider 执行 squash merge
- **AND** provider 必须在支持时携带 head SHA match 参数
- **AND** 记录 merge 结果

#### Scenario: merge conflict

- **WHEN** merge 检测到冲突
- **THEN** 系统不强行合并
- **AND** 进入 blocked 或 future conflict-resolution path
