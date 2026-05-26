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

系统 SHALL 在 JSON surface 中包含 surface_id、surface_kind、task、project、attempt、current_state、execution_plan、workspace、workflow_runs、agent_sessions、pull_request、human_requests、autonomy_guidance、available_tools、denied_actions、recommended_next_step、recovery、artifact_root、created_at。若 task 或 workflow run 存在 human explicit selection、runtime auto selection 或 actual profile，surface SHALL 以摘要方式展示给 agent 作为事实，而不是要求 agent 再次选择。

#### Scenario: workflow running surface 推荐等待 handoff

- **WHEN** workflow run 状态为 running 且未 handoff
- **THEN** Markdown surface 的 recommended next step 表达 inspect workflow 或等待 handoff
- **AND** recovery 文案不暗示 Coordinator 可以绕过 workflow protocol 执行内部 action

#### Scenario: workflow selection 作为事实展示

- **WHEN** workflow run 已启动并持久化 actual profile
- **THEN** surface 可以展示 actual profile 摘要
- **AND** surface 不要求 outer Agent 校正或重新选择 profile

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

### Requirement: Operator diagnosis 不得扩大 Coordinator Agent surface

系统 SHALL 将 operator-only diagnosis summary 与 Coordinator Agent surface 分离。diagnosis 可以进入 Web/API operator task detail，但不得自动进入 agent-facing Markdown surface，不得新增 agent-facing recovery tool，也不得让 available tools 暴露 operator-only 或 daemon/internal action。

#### Scenario: diagnosis 存在时生成 surface

- **WHEN** task detail 中存在 operator diagnosis summary
- **THEN** Coordinator Surface available tools 仍只包含当前状态允许的 agent tools
- **AND** available tools 不包含 `diagnose_task`、`replay_operation`、`recover_task`、`release_lock`、`daemon_tick`、`approve_merge` 或 `record_human_answer`
- **AND** agent-facing Markdown 不包含完整 operation JSON、provider raw output、lock token 或完整 recovery matrix

### Requirement: Coordinator Surface 不得暴露 raw provider events

系统 SHALL 保持 agent-facing Coordinator Surface 对 provider observability 的可见性收窄。Surface MAY 展示 recent agent session 的 provider、status、artifact refs 和短 activity 摘要；MUST NOT 内联 raw provider events、完整 transcript、provider private session path、permission internals 或 SDK-specific event object。

#### Scenario: 生成包含 agent session 的 surface

- **WHEN** task 存在 agent session activity summary
- **THEN** JSON surface 和 Markdown surface 最多展示 session status、provider id、last activity、latest normalized summary 和 artifact refs
- **AND** surface 不包含 raw JSONL、完整 stdout/stderr、provider private session path 或 permission object

#### Scenario: normalized event 不扩大 tool visibility

- **WHEN** surface 生成时存在 latest normalized agent event
- **THEN** available tools 仍只由 Core 当前状态和 contracts tool visibility matrix 决定
- **AND** surface 不因为 provider event 出现新增 debug、recovery、workflow action 或 Web operator tool

### Requirement: Coordinator Surface 必须收窄 workflow runtime observation

系统 SHALL 保持 workflow runtime observation 对 Coordinator Agent 的可见性收窄。Surface MAY 展示 workflow 正在 observing runtime、waiting handoff 或 waiting operator gate 的短摘要，但 MUST NOT 因 observation 暴露 workflow action executor、operator-only API、action input form、raw workflow status、SDK raw event 或 debug-only action queue。

#### Scenario: observing runtime does not expand tools

- **WHEN** 系统生成 workflow running surface
- **AND** workflow runtime observation 为 observing runtime
- **THEN** available_tools 仍只包含当前 contracts 允许的 agent tools，例如 inspect workflow 或 ask human
- **AND** available_tools 不包含 workflow action helper、Web action endpoint、daemon tick 或 operator task controls

#### Scenario: operator gate remains operator-only

- **WHEN** workflow runtime observation 为 waiting operator gate
- **THEN** Coordinator Agent Surface 不暴露 `freeze-requirements` 等 workflow action executor
- **AND** agent-facing Markdown 不要求 outer Agent 代替 operator 确认 gate

#### Scenario: surface does not leak debug payload

- **WHEN** surface 展示 workflow runtime observation 摘要
- **THEN** Markdown 和 JSON surface 不包含完整 `actionInputs` raw payload、`.workflow` private path、provider raw JSONL、permission object 或复杂 workflow status JSON

### Requirement: Coordinator Surface 必须只暴露 attachment refs

系统 SHALL 在 task brief / operator summary 中暴露 task attachments 的短 metadata 和 artifact refs；系统 SHALL NOT 将附件正文、base64、图片内容、raw binary payload 或完整文件预览写入 Coordinator Agent Surface。

#### Scenario: surface 展示 attachment ref

- **WHEN** task 存在 attachments
- **THEN** Coordinator Surface Markdown 可以列出 attachment safe filename、MIME/size 摘要和 artifact path
- **AND** Surface JSON 只包含 artifact refs 或短 metadata

#### Scenario: 大文件内容不进入 prompt

- **WHEN** attachment 是图片、PDF、日志或其他二进制/长文本文件
- **THEN** agent-facing Markdown 不包含文件正文或 base64
- **AND** agent 只能通过明确 artifact ref 判断是否需要读取

### Requirement: Task note 必须作为 artifact/ref 暴露

系统 SHALL 将 Web Composer 追加的 task note 写入 artifact，并在 Surface 中只以 recent context ref 或 event summary 呈现；note 不得成为 hidden memory 或绕过 current task state 的隐式状态。

#### Scenario: task note 进入 surface ref

- **WHEN** operator 通过 Composer 追加 task note
- **THEN** Core 写入 task note artifact 和 event
- **AND** Surface 可展示最近 note artifact ref
- **AND** Surface 不把所有历史 note 正文无限拼入 prompt

