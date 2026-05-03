## ADDED Requirements

### Requirement: 系统必须提供 PR/MR 相关 agent tools
系统 SHALL 在符合 surface gate 的前提下，向 Coordinator Agent 暴露 PR/MR 相关工具，用于创建、更新、检查 review、请求 approval 和在有效 approval 后 merge。

#### Scenario: pr_ready 可见 create_pr
- **WHEN** workflow handoff 为 `pr_ready`
- **THEN** surface 至少暴露 `create_pr`

#### Scenario: open PR 可见 review 工具
- **WHEN** 当前存在 open PR/MR
- **THEN** surface 可以暴露 `inspect_review` 与 `update_pr`
- **AND** 不暴露 operator-only approval 工具

#### Scenario: approval 有效才可 merge
- **WHEN** approval snapshot 有效
- **THEN** surface 可以暴露 `merge_after_approval`
- **AND** 未审批时不暴露该工具

