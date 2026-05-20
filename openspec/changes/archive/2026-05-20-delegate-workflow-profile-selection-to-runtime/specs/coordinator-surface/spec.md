## MODIFIED Requirements

### Requirement: 工具可见性必须按当前状态收窄

系统 SHALL 按 `docs/contracts.md` 的 tool visibility matrix 派生当前可见 agent tools，且不得包含 operator-only tools。workspace ready 且允许启动 workflow 时，surface 可以暴露 `start_workflow_run`，但不得要求外层 Coordinator Agent 选择具体 workflow profile，也不得把 workflow capability catalogue 暴露为 agent profile 决策源。

#### Scenario: workspace ready surface 暴露 profile-less workflow start

- **WHEN** 当前 attempt 有 ready workspace
- **AND** 当前没有 active workflow run
- **THEN** surface 可以暴露 `start_workflow_run`
- **AND** tool description 不包含必须由 agent 填写的 `--profile <profile-id>`
- **AND** Markdown 说明 workflow profile 将由 workflow runtime 自动选择，除非任务已有 human explicit selection

#### Scenario: workflow running surface 只允许 inspect 或 ask human

- **WHEN** 当前 attempt 有 workflow run 状态为 running
- **THEN** surface 不暴露 `start_workflow_run`
- **AND** surface 不暴露 workflow action executor 或 workflow debug action tool
- **AND** surface 可以暴露 `inspect_workflow_run` 和 `ask_human`

### Requirement: Surface 必须包含必需字段

系统 SHALL 在 JSON surface 中包含 surface_id、surface_kind、task、project、attempt、current_state、execution_plan、workspace、workflow_runs、agent_sessions、pull_request、human_requests、autonomy_guidance、available_tools、denied_actions、recommended_next_step、recovery、artifact_root、created_at。若 task 或 workflow run 存在 human explicit selection、runtime auto selection 或 actual profile，surface SHALL 以摘要方式展示给 agent 作为事实，而不是要求 agent 再次选择。

#### Scenario: workflow running surface 推荐等待 handoff

- **WHEN** workflow run 状态为 running 且未 handoff
- **THEN** Markdown surface 的 recommended next step 表达 inspect workflow 或等待 handoff
- **AND** recovery 文案不暗示 Coordinator 可以绕过 workflow protocol 执行内部 action

#### Scenario: workflow selection 作为事实展示

- **WHEN** workflow run 已启动并持久化 actual profile
- **THEN** surface 可以展示 actual profile 摘要
- **AND** surface 不要求 outer Agent 校正或重新选择 profile
