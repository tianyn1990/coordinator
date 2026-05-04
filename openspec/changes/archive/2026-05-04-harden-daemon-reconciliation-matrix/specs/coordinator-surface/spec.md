## ADDED Requirements

### Requirement: Surface 不得暴露内部 recovery matrix
系统 SHALL 保持 Coordinator Surface 的 agent-facing Markdown 和 available tools 收窄，不得因为 daemon/Core recovery matrix 引入内部 recovery tool 或暴露 operation replay、lock、provider raw output 等内部细节。

#### Scenario: recovery matrix 不新增 agent tool
- **WHEN** 系统生成任意 Coordinator Surface
- **THEN** available tools 不包含 `reconcile_resource`、`recover_task`、`replay_operation`、`release_lock` 或其他内部 recovery tool

#### Scenario: Markdown surface 只展示恢复摘要
- **WHEN** task 存在 recovery decision 或 recovery event
- **THEN** agent-facing Markdown 最多展示 current blocker、recovery 摘要、recommended next step、allowed/denied tools 和必要 artifact refs
- **AND** Markdown 不包含 provider raw output、lock token、完整 operation JSON 或完整 recovery matrix
