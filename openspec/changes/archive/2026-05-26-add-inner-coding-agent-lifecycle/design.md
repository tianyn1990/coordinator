## Context

Coordinator 当前已经具备三段关键能力：

- 通过 SDK-first `AgentProvider` 运行 outer Coordinator Agent，并保存 prompt、surface、transcript、final response 和 normalized activity。
- 通过 workflow protocol 启动、inspect 和 operator-only action，且不读取 `.workflow` private state。
- 通过 workflow gate evidence 阻止 Web/API 在缺少 inner coding agent 可见输出时盲确认 `freeze-requirements`。

缺口在于：Coordinator 还没有真正由 Core/daemon 启动和观察 `role=inner` coding agent。结果是 workflow 到达 operator gate 时，Core 可以判断 missing evidence，却没有受控路径生成 evidence。根据 `docs/workflow-agent-lifecycle-handoff.md`，Coordinator 应该观察和管理 inner coding agent 生命周期，等 agent 停止后再结合 SDK 输出和 workflow protocol 状态判断，而不是把所有 `allowedActions` 变成 Web 按钮。

本期明确不修改 `/Users/hetao/Documents/github/workflow`，不要求 workflow protocol 增加 `operatorActions`、`agentActions`、`blocker.owner` 或 `agent.state`。

## Goals / Non-Goals

**Goals:**

- 在 Core 中提供 `runInnerCodingAgentSession`，复用现有 SDK-first provider adapter。
- inner provider cwd 必须是 attempt workspace 的 `repo/`，outer provider cwd 仍必须是 `coordinator/sessions/<id>/`。
- inner session 使用 `role=inner`、绑定 task/attempt，并写入 final response artifact，供 gate evidence 消费。
- daemon 在 active workflow run 缺少 ready evidence 且没有 active inner session 时启动 inner coding agent；agent 运行中只观察。
- inner session 完成后，daemon 通过 workflow protocol `status` 做 read-only inspect/reconcile，刷新 stage/substate/action/handoff projection。
- Web/operator detail 能看到 inner session activity/final response refs，但 workflow action submit 仍只由 Core evidence gate 允许。

**Non-Goals:**

- 不修改 workflow 工程或 workflow protocol schema。
- 不让 daemon、outer Agent 或 Web 自动执行 `workflow protocol action`。
- 不实现完整 cancel/resume provider session 语义；本轮只做 operation-first 单次 session run 和 active-session 防重。
- 不读取 `.workflow` private state，不扫描 workflow artifact 正文来猜 change id。
- 不把 raw SDK JSONL、hidden reasoning、permission internals 或完整 transcript 放入 Coordinator Surface 或 gate evidence 主内容。
- 不重做 Web UI；只补必要展示和模型字段，后续 Web 重构另行推进。

## Decisions

### 1. inner agent runtime 复用 AgentProvider interface

`CodexProvider` / `ClaudeCodeProvider` 已经统一成 SDK-first adapter。本轮不新增新的 provider abstraction，而是在现有 `AgentProviderRunInput.metadata.role` 上区分 outer/inner，并由 provider adapter 选择权限 profile。

原因：

- 避免再次引入一套 provider lifecycle。
- 保持 fake provider tests 可注入。
- SDK raw events、normalized activity、final response artifact 继续走同一套观测边界。

权限策略：

- Codex outer：`read-only + approval never`，保持现状。
- Codex inner：`workspace-write + approval never`，cwd 约束在 workspace repo，默认不打开网络。
- Claude outer：`dontAsk + tools none`，保持现状。
- Claude inner：`acceptEdits + claude_code preset tools`，不使用 `bypassPermissions`。

### 2. inner prompt 是 workflow-aware，不是 workflow protocol 变更

Core 生成 inner prompt 时只提供已持久化事实和稳定 protocol 入口：

- task/project/workspace/workflow run 摘要。
- workspace repo path、branch、workflow launcher、external run id。
- 明确要求 coding agent 使用 workflow protocol / workflow skill 推进，遇到 operator gate 时停止并输出 human-visible final response。
- 明确禁止读写 `.workflow` private state、自动确认 human gate、自动 merge。

这不是新的 workflow protocol，也不是让 Coordinator 解析自然语言作为状态机。final response 只作为 operator gate evidence；workflow run 状态仍由 protocol status/handoff 决定。

### 3. daemon 只启动和观察 inner agent，不代替它执行 action

daemon 的新规则是：

```text
active workflow + ready workspace + no active inner session + no ready gate evidence
=> run inner coding agent once for this workflow/action boundary
```

如果已经有 active inner session，daemon 只用 watchdog 观察。若 inner session 已完成，daemon 不基于 final response 自动确认 gate，而是 inspect workflow status，让 Web/API gate evidence 显示给 operator。

为了避免重复启动，inner session operation idempotency key 包含 task、attempt、workflow run、provider、workflow state version 和最近 workflow action boundary。最近 workflow action 之后如果又出现新的 gate，可允许新一轮 inner session 生成新的 evidence。

### 4. Web 只显示 inner evidence，不扩大 action surface

Web V2 现有 Agent Activity 已展示 provider/status/finalResponsePath。本轮只补齐 inner session role 和可见 evidence summary 的展示细节；`WorkflowActionGate` 仍依赖 `/workflow-runs/:id/gate-evidence` 返回的 `canSubmit`。`materialize-change` 等 internal action 继续只进 Workflow Lens / Debug Detail。

## Risks / Trade-offs

- [Risk] inner agent 可能长时间运行，API 请求会被 provider SDK 阻塞。  
  → Mitigation: 继续通过 API runtime worker 独立进程执行 daemon tick；worker timeout 可配置，超时后由现有 worker group cleanup 和 daemon recovery 处理。

- [Risk] inner agent prompt 过度暴露 outer Coordinator Surface 或 tools。  
  → Mitigation: inner prompt 使用专用上下文，不把 outer `available_tools` 作为可执行工具菜单给 coding agent。

- [Risk] repeated daemon tick 可能重复启动 inner session。  
  → Mitigation: 使用 active inner session 检查和稳定 operation idempotency key；同一 workflow state/action boundary 已 terminal 的 inner session 不重复启动。

- [Risk] SDK permission profile 过宽。  
  → Mitigation: Codex 只使用 `workspace-write` 而非 `danger-full-access`；Claude 不使用 `bypassPermissions`；cwd 和 workspace lock 强制约束在 repo workspace。

- [Risk] coding agent 输出被误当作协议真相。  
  → Mitigation: final response 只进入 gate evidence；workflow status/handoff 仍通过 protocol inspect 产生，Core 不从自然语言推导 completed、PR ready 或 merge。
