## ADDED Requirements

### Requirement: Observability 必须展示 inner coding agent lifecycle 摘要

系统 SHALL 在 operator task detail、execution summary、event timeline 或 Web Focus Drawer 中展示 inner coding agent session 的 role、provider、status、last activity、latest normalized event、final response artifact ref 和 raw event artifact ref。该摘要 MUST NOT 包含 hidden reasoning、完整 raw JSONL、完整 transcript、secret、lock token 或 permission object。

#### Scenario: task detail 返回 inner session 摘要

- **WHEN** task 存在 inner coding agent session
- **THEN** operator task detail 的 agent sessions 包含该 session
- **AND** summary 展示 role 为 `inner`、provider、status、activity 和 final response artifact ref
- **AND** 查询不触发 provider、workflow protocol 或 git inspect

#### Scenario: timeline 记录 inner session lifecycle

- **WHEN** inner coding agent session started、completed 或 failed
- **THEN** event timeline 记录对应 agent session event
- **AND** event payload 只包含 provider evidence、permission profile 名称、preview 和 artifact refs 的窄摘要

### Requirement: post-agent workflow inspect 必须可审计

系统 SHALL 在 inner session 完成后记录 workflow protocol status inspect 的 event 和 daemon action 摘要，用于 operator 判断 agent 输出与 workflow 状态是否一致。该 inspect 仍是 read-only protocol 操作，不得读取 `.workflow` private state。

#### Scenario: inner 后 inspect 可见

- **WHEN** daemon 完成 inner coding agent session 后执行 workflow status inspect
- **THEN** timeline 包含 `workflow.status_inspected` 或 `daemon.workflow_reconciled` 相关摘要
- **AND** event payload 不包含完整 workflow private state 或 raw action input payload
