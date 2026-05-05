# coordinator-surface Specification

## Purpose
定义 `Coordinator Surface` 的第一版契约：系统必须把 Core 中的机器状态翻译成同源的 machine JSON surface 与 agent-facing Markdown surface，并按当前状态收窄 agent tools。该规格覆盖 Iteration 4，不包含真实 agent tool 执行、daemon、workspace manager、workflow adapter 或 PR/MR provider。
## Requirements
### Requirement: Surface 必须同时生成 JSON 和 Markdown

系统 SHALL 从同一个 snapshot 生成 machine JSON surface 与 agent-facing Markdown surface，且两者共享同一个 `surface_id`。

#### Scenario: 生成 bootstrap surface

- **WHEN** Core 基于一个新 task snapshot 生成 surface
- **THEN** 返回结果同时包含 JSON surface 和 Markdown surface
- **AND** JSON 与 Markdown 引用同一个 `surface_id`

### Requirement: Surface 必须覆盖第一版 kind

系统 SHALL 支持 bootstrap、planning、execution、human_waiting、human_answered、review、merge_waiting、completed、failure、resume surface kind。

#### Scenario: fixture 覆盖所有 kind

- **WHEN** 测试加载第一版 surface fixtures
- **THEN** 每个 supported kind 至少有一个可生成 surface 的 fixture

### Requirement: Surface 必须包含必需字段

系统 SHALL 在 JSON surface 中包含 surface_id、surface_kind、task、project、attempt、current_state、execution_plan、workspace、workflow_runs、agent_sessions、pull_request、human_requests、autonomy_guidance、available_tools、denied_actions、recommended_next_step、recovery、artifact_root、created_at。

#### Scenario: 校验必需字段

- **WHEN** 生成任意 kind 的 surface
- **THEN** JSON surface 包含全部必需字段

### Requirement: 工具可见性必须按当前状态收窄

系统 SHALL 按 `docs/contracts.md` 的 tool visibility matrix 派生当前可见 agent tools，且不得包含 operator-only tools。

#### Scenario: 无计划任务

- **WHEN** task 尚无 execution plan
- **THEN** surface 只暴露 `write_execution_plan` 与 `ask_human`

#### Scenario: 等待 human request

- **WHEN** 当前存在 pending human request
- **THEN** surface 不暴露任何执行性副作用工具
- **AND** surface 不暴露 `record_human_answer`

#### Scenario: merge approval 有效

- **WHEN** PR/MR 已打开且 approval snapshot 有效
- **THEN** surface 可暴露 `merge_after_approval` 与 inspect 类工具

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

### Requirement: Autonomy 必须翻译为 agent 可读 guidance

系统 SHALL 将 conservative、balanced、aggressive 转换为规则文本，而不是只把 enum 暴露给 agent。

#### Scenario: balanced autonomy

- **WHEN** task autonomy 为 balanced
- **THEN** Markdown surface 描述哪些操作可以自主处理、哪些必须请求人类确认

### Requirement: Artifact root 和路径规则必须进入 surface

系统 SHALL 在 surface 中声明 canonical artifact root，并说明 agent tools 只接受相对此 root 的相对路径。

#### Scenario: 生成 planning surface

- **WHEN** surface 暴露写计划工具
- **THEN** Markdown surface 包含 artifact root 和相对路径规则

### Requirement: Memory trust boundary 必须进入 surface

系统 SHALL 在 surface 中明确 attempt-local、project-local、cross-project 的可见性规则，并禁止 hidden memory。

#### Scenario: 生成任意 surface

- **WHEN** surface 被生成
- **THEN** Markdown surface 明确不存在 hidden memory，project-local 记忆必须由 surface 显式暴露

### Requirement: DB task surface 入口必须通过 Core 生成

系统 SHALL 提供基于 `DbContext` 与 task id 的 surface 构建入口，由 Core 读取 task/project 并生成 surface；Web/CLI 不得自行拼接 agent guidance。

#### Scenario: CLI 查看 task surface

- **WHEN** 开发者通过 CLI 指定 database path 和 task id 查看 surface
- **THEN** CLI 输出由 Core 生成的 JSON 或 Markdown surface

#### Scenario: API 查看 task surface

- **WHEN** API 收到 task surface 查询请求
- **THEN** API 返回由 Core 生成的 surface

### Requirement: Surface 不得暴露内部 recovery matrix
系统 SHALL 保持 Coordinator Surface 的 agent-facing Markdown 和 available tools 收窄，不得因为 daemon/Core recovery matrix 引入内部 recovery tool 或暴露 operation replay、lock、provider raw output 等内部细节。

#### Scenario: recovery matrix 不新增 agent tool
- **WHEN** 系统生成任意 Coordinator Surface
- **THEN** available tools 不包含 `reconcile_resource`、`recover_task`、`replay_operation`、`release_lock` 或其他内部 recovery tool

#### Scenario: Markdown surface 只展示恢复摘要
- **WHEN** task 存在 recovery decision 或 recovery event
- **THEN** agent-facing Markdown 最多展示 current blocker、recovery 摘要、recommended next step、allowed/denied tools 和必要 artifact refs
- **AND** Markdown 不包含 provider raw output、lock token、完整 operation JSON 或完整 recovery matrix

### Requirement: Surface 不得暴露 workspace/lock 内部恢复字段
系统 SHALL 保持 Coordinator Surface 对 workspace/lock/fencing recovery 的 agent-facing 可见性收窄，只展示必要摘要和 artifact refs。

#### Scenario: lock token 不进入 Markdown surface
- **WHEN** task 存在 workspace/lock recovery event
- **THEN** agent-facing Markdown 不包含 lock token、leaseVersion、完整 ownership manifest 或完整 git output

#### Scenario: workspace recovery 不新增 agent tool
- **WHEN** 系统生成任意 Coordinator Surface
- **THEN** available tools 不包含 `release_lock`、`recover_workspace`、`reconcile_workspace` 或 `takeover_lock`

### Requirement: PR/MR recovery 不得扩大 Coordinator Agent surface

系统 SHALL 保持 PR/MR 与 merge recovery 为 Core/runtime 内部恢复能力或 operator-only observability，不得因此新增 agent-facing recovery tool，也不得暴露复杂内部字段。

#### Scenario: 不新增 PR/MR recovery agent tool

- **WHEN** PR/MR recovery 或 merge reconciliation 能力启用
- **THEN** Coordinator Surface 不包含 `recover_pr`、`reconcile_merge`、`force_merge` 或 provider-specific debug tool
- **AND** surface 仍只暴露当前状态允许的既有 agent tools

#### Scenario: surface 不泄漏内部恢复细节

- **WHEN** PR/MR recovery event、provider failure 或 approval invalidation 被写入
- **THEN** Coordinator Surface 可以展示人类可读摘要和 artifact refs
- **AND** Markdown 和 available tools 不包含 provider raw output、完整 operation JSON、完整 approval object、lock token 或复杂 JSON 参数
