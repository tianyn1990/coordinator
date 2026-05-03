# agent-provider-runtime Specification

## Purpose

定义 `coordinator` 第一版 Agent Provider Runtime 契约：系统必须通过可替换的 AgentProvider 启动外层 Coordinator Agent session，基于 Coordinator Surface 生成 prompt，保存 surface snapshot、prompt、transcript、final response，并把 session 机器事实、operation 和事件持久化。该规格不包含 daemon、agent tools executor、PR/MR provider 或 remote worker。

## ADDED Requirements

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

系统 SHALL 在启动 provider 前生成 Coordinator Surface，并把同源 JSON/Markdown surface snapshot 写入 session artifact。

#### Scenario: 启动 outer session

- **WHEN** operator 请求为 task 启动 outer Coordinator Agent session
- **THEN** 系统生成 Coordinator Surface
- **AND** 将 Markdown surface 作为 prompt 主输入
- **AND** 保存 `surface.json` 与 `surface.md`

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
