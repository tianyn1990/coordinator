## ADDED Requirements

### Requirement: Operator diagnosis 不得扩大 Coordinator Agent surface

系统 SHALL 将 operator-only diagnosis summary 与 Coordinator Agent surface 分离。diagnosis 可以进入 Web/API operator task detail，但不得自动进入 agent-facing Markdown surface，不得新增 agent-facing recovery tool，也不得让 available tools 暴露 operator-only 或 daemon/internal action。

#### Scenario: diagnosis 存在时生成 surface

- **WHEN** task detail 中存在 operator diagnosis summary
- **THEN** Coordinator Surface available tools 仍只包含当前状态允许的 agent tools
- **AND** available tools 不包含 `diagnose_task`、`replay_operation`、`recover_task`、`release_lock`、`daemon_tick`、`approve_merge` 或 `record_human_answer`
- **AND** agent-facing Markdown 不包含完整 operation JSON、provider raw output、lock token 或完整 recovery matrix
