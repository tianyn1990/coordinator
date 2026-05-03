## ADDED Requirements

### Requirement: Surface 必须在 PR/MR 生命周期中反映正确工具可见性
系统 SHALL 在 PR/MR 相关状态下根据 current surface gate 暴露受控工具，且 tool visibility 仍必须由 Core 决定，不得由外部平台状态直接驱动。

#### Scenario: workflow handoff pr_ready
- **WHEN** workflow run handoff 为 `pr_ready`
- **THEN** surface 可以暴露 `create_pr`

#### Scenario: PR/MR open
- **WHEN** 当前存在 open PR/MR
- **THEN** surface 可以暴露 `inspect_review`、`update_pr` 和 `ask_human`

#### Scenario: merge approval 有效
- **WHEN** approval snapshot 有效
- **THEN** surface 可以暴露 `merge_after_approval`
- **AND** merge 之前仍需重新校验 snapshot

