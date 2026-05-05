## ADDED Requirements

### Requirement: Surface 不得暴露 workspace/lock 内部恢复字段
系统 SHALL 保持 Coordinator Surface 对 workspace/lock/fencing recovery 的 agent-facing 可见性收窄，只展示必要摘要和 artifact refs。

#### Scenario: lock token 不进入 Markdown surface
- **WHEN** task 存在 workspace/lock recovery event
- **THEN** agent-facing Markdown 不包含 lock token、leaseVersion、完整 ownership manifest 或完整 git output

#### Scenario: workspace recovery 不新增 agent tool
- **WHEN** 系统生成任意 Coordinator Surface
- **THEN** available tools 不包含 `release_lock`、`recover_workspace`、`reconcile_workspace` 或 `takeover_lock`
