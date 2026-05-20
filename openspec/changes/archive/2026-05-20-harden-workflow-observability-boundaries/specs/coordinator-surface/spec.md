## MODIFIED Requirements

### Requirement: 工具可见性必须按当前状态收窄

系统 SHALL 按 `docs/contracts.md` 的 tool visibility matrix 派生当前可见 agent tools，且不得包含 operator-only tools。

#### Scenario: workflow running surface 只允许 inspect 或 ask human

- **WHEN** 当前 attempt 有 workflow run 状态为 running
- **THEN** surface 不暴露 `start_workflow_run`
- **AND** surface 不暴露 workflow action executor 或 workflow debug action tool
- **AND** surface 可以暴露 `inspect_workflow_run` 和 `ask_human`

### Requirement: Surface 必须包含必需字段

系统 SHALL 在 JSON surface 中包含 surface_id、surface_kind、task、project、attempt、current_state、execution_plan、workspace、workflow_runs、agent_sessions、pull_request、human_requests、autonomy_guidance、available_tools、denied_actions、recommended_next_step、recovery、artifact_root、created_at。

#### Scenario: workflow running surface 推荐等待 handoff

- **WHEN** workflow run 状态为 running 且未 handoff
- **THEN** Markdown surface 的 recommended next step 表达 inspect workflow 或等待 handoff
- **AND** recovery 文案不暗示 Coordinator 可以绕过 workflow protocol 执行内部 action
