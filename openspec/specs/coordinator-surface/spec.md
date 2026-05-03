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
