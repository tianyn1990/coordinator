# agent-provider-runtime Specification

## Purpose
定义 `coordinator` 第一版 Agent Provider Runtime 契约：系统必须通过可替换的 AgentProvider 启动外层 Coordinator Agent session，基于 Coordinator Surface 生成 prompt，保存 surface snapshot、prompt、transcript、final response，并把 session 机器事实、operation 和事件持久化。该规格不包含 daemon、agent tools executor、PR/MR provider 或 remote worker。
## Requirements
### Requirement: 系统必须提供可替换 AgentProvider interface

系统 SHALL 提供统一 `AgentProvider` interface，并支持 `codex`、`claude-code`、`fake` provider id。

#### Scenario: 查询 provider metadata

- **WHEN** runtime 选择 provider
- **THEN** provider 暴露 id、kind 和 capabilities
- **AND** runtime 不把 provider brand 当作业务语义

#### Scenario: fake provider contract

- **WHEN** 测试使用 fake provider 启动 session
- **THEN** 系统不执行外部进程
- **AND** 返回确定性 final response

### Requirement: Coordinator Agent session 必须基于 Coordinator Surface 运行

系统 SHALL 在启动 provider 前生成 Coordinator Surface，并把同源 JSON/Markdown surface snapshot 写入 session artifact。系统 SHALL 在 Coordinator Agent prompt 中说明 agent 只能基于当前 Surface 行动，并且最终回复最多请求一个 coordinator-tool。复杂内容必须通过 artifact-first 方式传递，工具参数保持一层 key/value。

#### Scenario: 非 artifact 工具不鼓励输出 artifact block

- **WHEN** 当前可见工具是 create_attempt、create_workspace、start_workflow_run 或 inspect_workflow_run
- **THEN** prompt 明确这些普通推进或观察工具默认不需要 coordinator-artifact
- **AND** agent 只有在工具明确需要 artifact 或计划/报告确实修订时才输出 coordinator-artifact
- **AND** prompt 继续保留 artifact-based tool 的写入规则

### Requirement: Agent session 启动必须 operation-first 并受 lock 保护

系统 SHALL 在执行 provider 外部进程前创建 `agent:session:<task-id>:outer:<provider-id>:<request-id>` operation，并获取 task agent lock。`request-id` 必须稳定；未显式传入时使用 `task-v<task.stateVersion>`。

#### Scenario: 启动 agent session

- **WHEN** task 存在且 provider 可用
- **THEN** 系统先创建 operation 与 lock
- **AND** 创建 `starting` agent session record
- **AND** 执行 provider
- **AND** 成功后更新 session 为 `completed`
- **AND** append `agent.session_completed` event

#### Scenario: 默认 idempotency key 稳定

- **WHEN** operator 未显式传入 request id
- **THEN** operation idempotency key 使用 `task-v<task.stateVersion>`
- **AND** 不使用随机 surface id 作为 idempotency key 的一部分

#### Scenario: 重复 active outer session

- **WHEN** 同一 task 已有 active outer agent session
- **THEN** 系统拒绝创建第二个 active outer session

### Requirement: Provider 参数必须保持窄

系统 SHALL 通过 prompt/surface artifact 传递复杂上下文，provider runner 参数只包含 cwd、prompt path、output path、transcript path、timeout 和少量 metadata。

#### Scenario: provider runner 参数检查

- **WHEN** runtime 调用 provider
- **THEN** provider runner 不接收完整 task/project/workflow JSON
- **AND** prompt 内容来自 session prompt artifact
- **AND** provider cwd 指向 sessionRoot，不指向 project repo 或 workspace repo

### Requirement: Agent session artifacts 必须可观测

系统 SHALL 保存 prompt、surface JSON、surface Markdown、transcript 和 final response artifact，并在 event 中记录 artifact refs。

#### Scenario: session 完成

- **WHEN** provider 成功返回 final response
- **THEN** `final-response.md` 存在
- **AND** `transcript.jsonl` 存在
- **AND** artifact store 至少登记 prompt、surface、transcript、final response

### Requirement: provider failure 必须有受控失败语义

系统 SHALL 在 provider 执行失败时更新 operation/session，并记录可恢复 event。

#### Scenario: provider 执行失败

- **WHEN** provider runner 抛出错误
- **THEN** session 状态更新为 `failed` 或 `unknown`
- **AND** operation 状态更新为 `failed` 或 `unknown`
- **AND** event store 记录 `agent.session_failed`

### Requirement: CLI/API agent 入口必须是 operator-only

系统 SHALL 提供 CLI/API 的 agent run/inspect 调试入口，但这些入口不得进入 Coordinator Surface 的 agent tools。

#### Scenario: CLI 启动 agent session

- **WHEN** operator 通过 CLI 指定 database path 和 task id 启动 agent session
- **THEN** CLI 返回 agent session 结果

#### Scenario: API 查询 agent session

- **WHEN** operator 调用 API 查询 agent session
- **THEN** API 返回 session 机器事实和 artifact refs

### Requirement: AgentProvider runtime 必须优先使用 SDK adapter

系统 SHALL 将 `codex` 和 `claude-code` outer AgentProvider 的主路径实现为 SDK-first adapter，并保留 CLI subprocess compatibility fallback。SDK-first adapter MUST 继续实现统一 `AgentProvider` interface，Core/daemon/API/CLI 不得依赖 provider-specific SDK 类型或 provider private session 文件。

#### Scenario: Codex provider 默认使用 SDK-first adapter

- **WHEN** runtime 创建 `codex` provider
- **AND** Codex SDK adapter 可用
- **THEN** provider 通过 SDK adapter 启动 outer Coordinator Agent session
- **AND** provider result 记录 implementation mode 为 `sdk`
- **AND** provider cwd 指向 sessionRoot，不指向 project repo 或 workspace repo

#### Scenario: Claude Code provider 默认使用 SDK-first adapter

- **WHEN** runtime 创建 `claude-code` provider
- **AND** Claude Agent SDK adapter 可用
- **THEN** provider 通过 SDK adapter 启动 outer Coordinator Agent session
- **AND** provider result 记录 implementation mode 为 `sdk`
- **AND** provider cwd 指向 sessionRoot，不指向 project repo 或 workspace repo

#### Scenario: SDK unavailable 时受控 fallback

- **WHEN** SDK 模块、provider auth 或本地 runtime 不可用
- **THEN** provider MAY 使用 CLI compatibility fallback
- **AND** fallback MUST 继续使用最小权限、sessionRoot cwd、prompt stdin 和窄参数
- **AND** provider result 记录 implementation mode 为 `cli-fallback`

### Requirement: Provider SDK raw events 必须只进入 artifact

系统 SHALL 将 SDK raw events、SDK stream items、provider stdout/stderr 摘要和 provider private session 线索视为排查证据，而不是 Core 状态机真相源。raw event MUST 写入 transcript 或 provider events artifact；Coordinator Surface、agent tool 参数、daemon recovery decision 和 Core task 状态不得直接消费 raw SDK event。

#### Scenario: raw event 写入 transcript artifact

- **WHEN** SDK adapter 返回 raw provider events
- **THEN** runtime 将 sanitized raw event 写入 session transcript 或 provider events artifact
- **AND** agent session completed event 只引用 artifact path 和窄摘要
- **AND** event payload 不包含完整 raw JSONL、provider private session 文件路径或 permission internals

#### Scenario: Surface 不暴露 SDK raw event

- **WHEN** 后续 Coordinator Surface 包含 agent session 信息
- **THEN** Surface MAY 展示 provider id、session status、artifact refs 和短摘要
- **AND** Surface MUST NOT 内联 SDK raw event、完整 transcript、provider private session path 或 permission object

### Requirement: Outer provider permission profile 必须保持 decision-only

系统 SHALL 为 outer Coordinator Agent SDK session 使用最小权限 profile。Codex SDK session MUST 使用 read-only sandbox 与 never approval 等价语义；Claude Agent SDK session MUST 使用 `dontAsk` 或更严格 permission mode，并禁用或最小化 tools。任何 SDK adapter 都不得把 cwd 指向 project repo 或 workspace repo 的 `repo/` 目录。

#### Scenario: Codex SDK 权限最小化

- **WHEN** Codex SDK adapter 启动 outer session
- **THEN** adapter 配置 read-only sandbox
- **AND** adapter 配置 never approval 或等价非交互策略
- **AND** adapter 不授予 repo write 权限

#### Scenario: Claude SDK 权限最小化

- **WHEN** Claude Agent SDK adapter 启动 outer session
- **THEN** adapter 配置 `dontAsk` 或更严格 permission mode
- **AND** adapter 使用空 tools 或最小 tools
- **AND** adapter 不授予 repo write 权限

### Requirement: SDK provider result 必须保留统一 session evidence

系统 SHALL 将 SDK session id、provider version、implementation mode、permission profile、final response 和 raw event artifact ref 收敛为统一 `AgentProviderRunResult`。这些字段 MAY 被写入 agent session transcript 和 narrow event payload；它们 MUST NOT 让 Core 根据 provider-specific event 推断 task completed、PR readiness、merge readiness 或 workflow handoff。

#### Scenario: provider result 记录 SDK session evidence

- **WHEN** SDK adapter 成功完成 session
- **THEN** `AgentProviderRunResult` 包含 final response
- **AND** result MAY 包含 provider session id、provider version、permission profile、implementation mode 和 raw event artifact ref
- **AND** runtime 将这些 evidence 写入 transcript artifact 或窄 event payload

#### Scenario: SDK event 不驱动外层业务完成

- **WHEN** SDK raw event 表示文件变更、命令完成、工具调用或模型输出
- **THEN** Core 不基于该 raw event 直接标记 task done、PR ready、merge ready 或 workflow handoff
- **AND** 后续业务推进仍通过 Coordinator Agent final response、Core tool executor、workflow protocol handoff 或 human gate 完成

### Requirement: AgentProvider runtime 必须归一化 provider event

系统 SHALL 将 SDK / CLI provider 输出分层处理为 raw provider event artifact、normalized agent event 摘要和极少 lifecycle signal。normalized event MUST 使用 provider-agnostic 白名单 kind；未知 raw event 不得以内联完整 JSON 进入 Core event payload、Coordinator Surface 或 agent tool 参数。

#### Scenario: SDK raw event 写入 provider events artifact

- **WHEN** SDK adapter 返回 raw provider events
- **THEN** runtime 写入 `provider-events.jsonl` 或兼容 transcript artifact
- **AND** session completed / failed event payload 只包含 artifact ref、event count 和窄摘要
- **AND** event payload 不包含完整 raw JSONL、provider private session path 或 permission internals

#### Scenario: raw event 归一化为白名单摘要

- **WHEN** provider 输出 turn、message、tool、permission、result 或 failure 事件
- **THEN** runtime 将可识别事件映射为 normalized agent event
- **AND** normalized event 只包含 kind、summary、timestamp、severity 和有限 metadata
- **AND** 未识别事件只记录为 unknown/provider event 计数或短摘要

### Requirement: AgentProvider result 必须提供 agent activity 摘要

系统 SHALL 从 provider result、normalized events 和 session artifact 派生 operator-facing `agentActivity` 摘要。该摘要 MAY 进入 Core event payload 和 operator task detail；MUST NOT 直接驱动 task completed、PR readiness、merge readiness 或 workflow handoff。

#### Scenario: session 完成时记录 activity 摘要

- **WHEN** provider session 成功完成
- **THEN** runtime 记录 latest normalized event、last activity time、implementation mode、permission profile、provider session id、provider version 和 artifact refs
- **AND** final response artifact 仍作为 Coordinator Agent 决策输出的主要证据

#### Scenario: session 失败时记录 failure signal

- **WHEN** provider session 失败
- **THEN** runtime 记录 failure kind、latest normalized event、last activity time 和 artifact refs
- **AND** failure signal 只用于 recovery observation 和 operator diagnosis
- **AND** Core 不根据 raw provider event 猜测业务是否已完成

### Requirement: AgentProvider runtime 必须保留 operator-visible message evidence

系统 SHALL 将 SDK-first provider 输出分为 raw event artifact、normalized activity 和 operator-visible message evidence。operator-visible message evidence MAY 来自 final response artifact、assistant message item 或 provider-approved visible message summary；hidden chain-of-thought、provider private state、permission internals 和完整 raw JSONL MUST NOT 进入 evidence。

#### Scenario: inner agent final response 可作为 evidence

- **WHEN** inner coding agent session 通过 SDK provider 完成并写入 final response artifact
- **THEN** Core 可以把该 final response 的受限摘要作为 workflow gate evidence 主消息
- **AND** evidence 只引用 transcript/raw event artifact，不内联完整 raw JSONL

#### Scenario: raw event 不成为 gate evidence 主内容

- **WHEN** SDK stream 输出 tool call、command output、reasoning、permission 或 provider raw event
- **THEN** runtime 只把它们写入 transcript/provider event artifact 或 normalized activity 摘要
- **AND** gate evidence 不默认展示这些 raw event 正文

